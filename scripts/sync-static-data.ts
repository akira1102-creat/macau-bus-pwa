import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  BusStop,
  CatalogProvenance,
  Coordinates,
  DirectionId,
  RouteSummary,
  SegmentTime,
  TransitCatalog,
} from '../shared/transit-contract';
import { TransitCatalogSchema } from '../shared/transit-contract';

export const UPSTREAM_REPOSITORY = 'https://github.com/ChiHin-Lio/macau-bus-data';
export const UPSTREAM_RAW_BASE = 'https://raw.githubusercontent.com/ChiHin-Lio/macau-bus-data';
export const DEFAULT_UPSTREAM_REF = '7f4520a4416415a4663d9afd0ad94da0c19d5b26';
export const UPSTREAM_FILES = [
  'bus-stops.json',
  'operators.json',
  'route-metadata.json',
  'route-stops.json',
  'segment_times.json',
] as const;
export type UpstreamFile = (typeof UPSTREAM_FILES)[number];

export interface UpstreamStaticData {
  busStops: unknown;
  operators: unknown;
  routeMetadata: unknown;
  routeStops: unknown;
  segmentTimes: unknown;
}

export interface CatalogBuildOptions {
  generatedAt: string;
  provenance: CatalogProvenance;
}

export type ProvenanceInput = CatalogProvenance;

export interface SyncOptions {
  ref?: string;
  syncedAt?: string;
  outputDir?: string;
  upstreamDir?: string;
  fetch?: typeof globalThis.fetch;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a JSON array`);
  }
  return value;
}

function requiredString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function parseCoordinates(value: unknown, label: string): Coordinates {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((part) => typeof part === 'number' && Number.isFinite(part))) {
    throw new Error(`${label}.coordinates must be a finite [longitude, latitude] pair`);
  }
  const longitude = value[0] as number;
  const latitude = value[1] as number;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new Error(`${label}.coordinates is outside the geographic range`);
  }
  return [longitude, latitude];
}

function parseStop(value: unknown, index: number): BusStop {
  const record = asRecord(value, `bus-stops[${index}]`);
  const routeIds = Array.isArray(record.routeIds)
    ? record.routeIds.filter((route): route is string => typeof route === 'string').map((route) => route.trim()).filter(Boolean)
    : [];
  return {
    id: requiredString(record, 'id', `bus-stops[${index}]`),
    name: requiredString(record, 'name', `bus-stops[${index}]`),
    nameCn: requiredString(record, 'nameCn', `bus-stops[${index}]`),
    ...(optionalString(record, 'nameEn') ? { nameEn: optionalString(record, 'nameEn') } : {}),
    ...(optionalString(record, 'namePor') ? { namePor: optionalString(record, 'namePor') } : {}),
    coordinates: parseCoordinates(record.coordinates, `bus-stops[${index}]`),
    routeIds,
  };
}

function parseRouteStops(value: unknown, routeId: string): string[] {
  const values = asArray(value, `route-stops.${routeId}`);
  const stopIds = values.filter((stop): stop is string => typeof stop === 'string').map((stop) => stop.trim()).filter(Boolean);
  if (stopIds.length === 0) {
    throw new Error(`route-stops.${routeId} must contain at least one stop id`);
  }
  return stopIds;
}

function parseDirectionId(value: string): DirectionId | undefined {
  return value === '0' ? 0 : value === '1' ? 1 : undefined;
}

function parseNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return undefined;
}

function normalizeSegmentTimes(value: unknown): SegmentTime[] {
  const source = asRecord(value, 'segment_times');
  const result: SegmentTime[] = [];

  for (const [routeDirection, bucketValue] of Object.entries(source)) {
    const separator = routeDirection.lastIndexOf('_');
    const route = separator > 0 ? routeDirection.slice(0, separator) : '';
    const direction = parseDirectionId(routeDirection.slice(separator + 1));
    if (!route || direction === undefined) {
      continue;
    }
    const buckets = asRecord(bucketValue, `segment_times.${routeDirection}`);
    for (const [timeBucket, segmentsValue] of Object.entries(buckets)) {
      const segments = asRecord(segmentsValue, `segment_times.${routeDirection}.${timeBucket}`);
      for (const [segmentKey, statsValue] of Object.entries(segments)) {
        const separatorMatch = segmentKey.match(/^(.+?)(?:→|->)(.+)$/);
        if (!separatorMatch?.[1] || !separatorMatch[2]) {
          continue;
        }
        const stats = asRecord(statsValue, `segment_times.${routeDirection}.${timeBucket}.${segmentKey}`);
        const averageSeconds = parseNumber(stats, ['avg_sec', 'averageSeconds', 'average']);
        const medianSeconds = parseNumber(stats, ['p50', 'medianSeconds', 'median']);
        const p90Seconds = parseNumber(stats, ['p90', 'p90Seconds']);
        const samples = parseNumber(stats, ['samples']);
        result.push({
          route,
          direction,
          fromStopId: separatorMatch[1].trim(),
          toStopId: separatorMatch[2].trim(),
          ...(averageSeconds !== undefined ? { averageSeconds } : {}),
          ...(medianSeconds !== undefined ? { medianSeconds } : {}),
          ...(p90Seconds !== undefined ? { p90Seconds } : {}),
          ...(samples !== undefined ? { samples: Math.trunc(samples) } : {}),
          timeBucket,
        });
      }
    }
  }

  return result;
}

export function createProvenance(input: ProvenanceInput): CatalogProvenance {
  const names = input.files.map((file) => file.name);
  const expected = [...UPSTREAM_FILES].sort();
  if (names.length !== UPSTREAM_FILES.length || [...names].sort().join('|') !== expected.join('|')) {
    throw new Error(`provenance must list exactly ${UPSTREAM_FILES.join(', ')}`);
  }
  return {
    sourceRepository: input.sourceRepository,
    sourceRef: input.sourceRef,
    syncedAt: input.syncedAt,
    files: input.files.map((file) => ({ ...file })),
  };
}

export function buildCatalogFromUpstream(input: UpstreamStaticData, options: CatalogBuildOptions): TransitCatalog {
  const stops = asArray(input.busStops, 'bus-stops').map(parseStop);
  const operators = asRecord(input.operators, 'operators');
  const metadata = asRecord(input.routeMetadata, 'route-metadata');
  const metadataRoutes = asRecord(metadata.routes, 'route-metadata.routes');
  const routeStops = asRecord(input.routeStops, 'route-stops');
  const knownStopIds = new Set(stops.map((stop) => stop.id));

  // A few metadata-only services (for example circular or seasonal routes) do
  // not have an ordered entry in route-stops.json. They cannot be represented
  // safely in a direction/station catalog, so omit them rather than inventing
  // an order from the stop membership list.
  const routeIds = Object.keys(metadataRoutes)
    .filter((routeId) => Array.isArray(routeStops[routeId]))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const routes: RouteSummary[] = [];
  for (const routeId of routeIds) {
    const routeMetadata = asRecord(metadataRoutes[routeId], `route-metadata.routes.${routeId}`);
    const orderedStopIds = parseRouteStops(routeStops[routeId], routeId).filter((stopId) => knownStopIds.has(stopId));
    if (orderedStopIds.length === 0) {
      continue;
    }
    const displayName = optionalString(routeMetadata, 'nameCht') ?? routeId;
    const directionNames = asRecord(routeMetadata.directionNames ?? {}, `route-metadata.routes.${routeId}.directionNames`);
    const directions = ([0, 1] as const).map((id) => ({
      id,
      name: typeof directionNames[String(id)] === 'string' && directionNames[String(id)]
        ? String(directionNames[String(id)]).trim()
        : `${displayName} ${id}`,
      stopIds: id === 0 ? orderedStopIds : [...orderedStopIds].reverse(),
    }));
    routes.push({
      id: routeId,
      name: routeId,
      displayName,
      operator: typeof operators[routeId] === 'string' ? String(operators[routeId]).trim() : '',
      directions,
    });
  }

  return {
    version: 1,
    generatedAt: options.generatedAt,
    provenance: options.provenance,
    routes,
    stops,
    segmentTimes: normalizeSegmentTimes(input.segmentTimes),
  };
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function downloadJson(
  url: string,
  fetcher: typeof globalThis.fetch,
): Promise<{ bytes: Uint8Array; value: unknown }> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`upstream request failed for ${url}: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  try {
    return { bytes, value: JSON.parse(text) as unknown };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid JSON';
    throw new Error(`upstream response is not valid JSON for ${url}: ${reason}`);
  }
}

export async function syncStaticData(options: SyncOptions = {}): Promise<TransitCatalog> {
  const ref = options.ref ?? process.env.MACAU_BUS_DATA_REF ?? DEFAULT_UPSTREAM_REF;
  const syncedAt = options.syncedAt ?? new Date().toISOString();
  const fetcher = options.fetch ?? globalThis.fetch;
  const outputDir = resolve(options.outputDir ?? process.env.MACAU_BUS_DATA_DIR ?? 'public/data');
  const upstreamDir = resolve(options.upstreamDir ?? 'data/upstream');
  await mkdir(outputDir, { recursive: true });
  await mkdir(upstreamDir, { recursive: true });

  const downloaded = new Map<UpstreamFile, unknown>();
  const provenanceFiles: CatalogProvenance['files'] = [];
  for (const name of UPSTREAM_FILES) {
    const url = `${UPSTREAM_RAW_BASE}/${ref}/${name}`;
    const { bytes, value } = await downloadJson(url, fetcher);
    downloaded.set(name, value);
    await writeFile(join(upstreamDir, name), bytes);
    provenanceFiles.push({ name, url, ref, syncedAt, sha256: sha256(bytes) });
  }

  const provenance = createProvenance({
    sourceRepository: UPSTREAM_REPOSITORY,
    sourceRef: ref,
    syncedAt,
    files: provenanceFiles,
  });
  const catalog = TransitCatalogSchema.parse(
    buildCatalogFromUpstream(
      {
        busStops: downloaded.get('bus-stops.json'),
        operators: downloaded.get('operators.json'),
        routeMetadata: downloaded.get('route-metadata.json'),
        routeStops: downloaded.get('route-stops.json'),
        segmentTimes: downloaded.get('segment_times.json'),
      },
      { generatedAt: syncedAt, provenance },
    ),
  );
  await writeFile(join(outputDir, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  await writeFile(join(outputDir, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  return catalog;
}

async function main(): Promise<void> {
  const catalog = await syncStaticData();
  console.log(`同步完成：${catalog.routes.length} 條路線、${catalog.stops.length} 個站點；來源資料保持本機。`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
