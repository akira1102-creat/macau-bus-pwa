import type { Config, Context } from '@netlify/functions';
import { z } from 'zod';

import { remainingStopsToTarget } from '../../shared/arrival-distance';
import { DirectionIdSchema, RealtimeRouteResponseSchema, type DirectionId } from '../../shared/transit-contract';
import { DsatClientError } from '../../server/dsat/dsat-client';
import { getCatalogRepository } from './_shared/catalog';
import { guardApiRequest, jsonResponse, type ApiRequestOptions } from './_shared/http';
import { getNetlifyRuntime } from './_shared/runtime';

const ARRIVALS_API_OPTIONS: ApiRequestOptions = {
  methods: ['POST'],
};
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_STOP_IDS = 5;

export const ArrivalsRequestSchema = z.object({
  stopIds: z.array(z.string()),
});

export const ArrivalRowSchema = z.object({
  stopId: z.string().trim().min(1),
  route: z.string().trim().min(1),
  direction: DirectionIdSchema,
  plate: z.string(),
  remainingStops: z.number().int().nonnegative(),
});

export const ArrivalsResponseSchema = z.object({
  updatedAt: z.string().datetime({ offset: true }),
  arrivals: z.array(ArrivalRowSchema),
});

type ArrivalRow = z.infer<typeof ArrivalRowSchema>;

interface RouteDirectionTargets {
  route: string;
  direction: DirectionId;
  targets: Map<string, number[]>;
}

function requestTooLarge(request: Request): boolean {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const parsed = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsed) && parsed > MAX_REQUEST_BYTES) {
      return true;
    }
  }
  return false;
}

function clientKey(context: Context): string {
  return context.ip?.trim() || 'unknown-client';
}

function upstreamError(error: unknown): ResponseError {
  const diagnosticCode = error instanceof DsatClientError ? error.code : 'unknown';
  console.error(JSON.stringify({ event: 'dsat-arrivals-failed', code: diagnosticCode }));
  return { error: 'upstream-error', diagnosticCode };
}

interface ResponseError {
  error: 'upstream-error';
  diagnosticCode: string;
}

function buildTargets(
  catalog: Awaited<ReturnType<typeof getCatalogRepository>>,
  stopIds: readonly string[],
): RouteDirectionTargets[] {
  if (!catalog) return [];

  const requested = new Set(stopIds);
  const groups = new Map<string, RouteDirectionTargets>();
  for (const route of catalog.catalog.routes) {
    for (const direction of route.directions) {
      const targets = new Map<string, number[]>();
      direction.stopIds.forEach((stopId, index) => {
        if (!requested.has(stopId)) return;
        const occurrences = targets.get(stopId) ?? [];
        occurrences.push(index);
        targets.set(stopId, occurrences);
      });
      if (targets.size > 0) {
        groups.set(`${route.id}|${direction.id}`, {
          route: route.id,
          direction: direction.id,
          targets,
        });
      }
    }
  }
  return [...groups.values()];
}

function compareRows(left: ArrivalRow, right: ArrivalRow): number {
  return left.remainingStops - right.remainingStops
    || left.route.localeCompare(right.route)
    || left.direction - right.direction
    || left.plate.localeCompare(right.plate)
    || left.stopId.localeCompare(right.stopId);
}

export default async function arrivalsHandler(request: Request, context: Context): Promise<Response> {
  const guarded = guardApiRequest(request, ARRIVALS_API_OPTIONS);
  if (guarded) return guarded;

  if (requestTooLarge(request)) {
    return jsonResponse(request, { error: 'request-too-large' }, 413, {}, ARRIVALS_API_OPTIONS);
  }

  if (!getNetlifyRuntime().rateLimiter.allow(clientKey(context))) {
    return jsonResponse(request, { error: 'rate-limit-exceeded' }, 429, {}, ARRIVALS_API_OPTIONS);
  }

  let payload: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
      return jsonResponse(request, { error: 'request-too-large' }, 413, {}, ARRIVALS_API_OPTIONS);
    }
    payload = JSON.parse(body) as unknown;
  } catch {
    return jsonResponse(request, { error: 'invalid-json' }, 400, {}, ARRIVALS_API_OPTIONS);
  }

  const parsed = ArrivalsRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonResponse(request, { error: 'invalid-request' }, 400, {}, ARRIVALS_API_OPTIONS);
  }
  const stopIds = [...new Set(parsed.data.stopIds.map((stopId) => stopId.trim()).filter(Boolean))];
  if (stopIds.length === 0) {
    return jsonResponse(request, { error: 'invalid-request' }, 400, {}, ARRIVALS_API_OPTIONS);
  }
  if (stopIds.length > MAX_STOP_IDS) {
    return jsonResponse(request, { error: 'too-many-stops' }, 413, {}, ARRIVALS_API_OPTIONS);
  }

  const catalog = await getCatalogRepository();
  if (!catalog) {
    return jsonResponse(request, { error: 'catalog-unavailable' }, 503, {}, ARRIVALS_API_OPTIONS);
  }
  const groups = buildTargets(catalog, stopIds);
  if (groups.length === 0) {
    return jsonResponse(request, {
      updatedAt: new Date().toISOString(),
      arrivals: [],
    }, 200, {}, ARRIVALS_API_OPTIONS);
  }

  const runtime = getNetlifyRuntime();
  try {
    const rows = (await Promise.all(groups.map(async (group): Promise<ArrivalRow[]> => {
      const result = await runtime.cache.get(`${group.route}|${group.direction}`, async () => {
        const upstream = await runtime.client.fetchRoute(group.route, group.direction);
        return RealtimeRouteResponseSchema.parse({
          route: group.route,
          direction: group.direction,
          updatedAt: new Date().toISOString(),
          ageSeconds: 0,
          stale: false,
          source: 'DSAT observation',
          buses: upstream.buses,
        });
      });

      const groupRows: ArrivalRow[] = [];
      for (const [stopId, targetIndexes] of group.targets) {
        for (const bus of result.value.buses) {
          const remaining = targetIndexes
            .map((targetIndex) => remainingStopsToTarget(
              catalog.getDirectionStops(group.route, group.direction).map((stop) => stop.id),
              bus.stationCode,
              targetIndex,
            ))
            .filter((value): value is number => value !== null);
          if (remaining.length === 0) continue;
          groupRows.push({
            stopId,
            route: group.route,
            direction: group.direction,
            plate: bus.plate,
            remainingStops: Math.min(...remaining),
          });
        }
      }
      return groupRows;
    }))).flat().sort(compareRows);

    const responseBody = ArrivalsResponseSchema.parse({
      updatedAt: new Date().toISOString(),
      arrivals: rows,
    });
    return jsonResponse(request, responseBody, 200, {}, ARRIVALS_API_OPTIONS);
  } catch (error) {
    const mapped = upstreamError(error);
    return jsonResponse(request, { error: mapped.error }, 502, {
      'X-Upstream-Error-Code': mapped.diagnosticCode,
    }, ARRIVALS_API_OPTIONS);
  }
}

export const config: Config = {
  path: '/api/bus/arrivals',
  method: ['POST', 'OPTIONS'],
};
