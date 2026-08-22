import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { CatalogRepository } from '../../../src/data/catalog-repository';
import { createCatalogRepository } from '../../../src/data/catalog-repository';
import { TransitCatalogSchema } from '../../../shared/transit-contract';
import { readFirstNetlifyEnv, readNetlifyEnv } from './env';

const CATALOG_TIMEOUT_MS = 3_000;
const PRODUCTION_ROUTE_IDS = new Set([
  '1', '1A', '2', '2A', '2AS', '3', '3A', '3AX', '3X', '4', '5', '5X',
  '6A', '6B', '7', '8', '8A', '9', '9A', '10', '10B', '11', '12', '15',
  '16', '16S', '17', '17S', '18', '18A', '18B', '19', '21A', '22', '23',
  '25', '25AX', '25B', '25BS', '26', '26A', '27', '28A', '28B', '28C',
  '29', '30', '30X', '32', '33', '34', '35', '36', '37', '39', '50', '50B',
  '51', '51A', '51B', '52', '55', '56', '59', '60', '61', '65', '71', '71S',
  '72', '73', '101', '102', '103', '701X', 'AP1', 'H1', 'H2', 'H3', 'MT1',
  'MT2', 'MT3', 'MT4', 'MT5', 'N1A', 'N1B', 'N2', 'N3', 'N5', 'N6',
]);

interface CatalogState {
  key: string;
  repository: Promise<CatalogRepository | undefined>;
}

let catalogState: CatalogState | undefined;

function defaultCatalogPath(): string {
  return fileURLToPath(new URL('../../../public/data/catalog.json', import.meta.url));
}

function catalogSourceKey(): string {
  return [
    readFirstNetlifyEnv(['CATALOG_URL', 'PUBLIC_CATALOG_URL']) ?? '',
    readNetlifyEnv('CATALOG_PATH') ?? '',
  ].join('|');
}

function parseCatalogText(text: string): CatalogRepository {
  const payload: unknown = JSON.parse(text);
  return createCatalogRepository(TransitCatalogSchema.parse(payload));
}

async function loadFromUrl(url: string): Promise<CatalogRepository> {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('catalog URL must use HTTP(S)');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const response = await globalThis.fetch(parsedUrl, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`catalog request failed with HTTP ${response.status}`);
    }
    return parseCatalogText(await response.text());
  } finally {
    clearTimeout(timer);
  }
}

async function loadFromPath(path: string): Promise<CatalogRepository> {
  return parseCatalogText(await readFile(path, 'utf8'));
}

async function loadCatalogRepository(): Promise<CatalogRepository | undefined> {
  const configuredUrl = readFirstNetlifyEnv(['CATALOG_URL', 'PUBLIC_CATALOG_URL']);
  try {
    if (configuredUrl) {
      return await loadFromUrl(configuredUrl);
    }
    return await loadFromPath(readNetlifyEnv('CATALOG_PATH') ?? defaultCatalogPath());
  } catch {
    return undefined;
  }
}

export function getCatalogRepository(): Promise<CatalogRepository | undefined> {
  const key = catalogSourceKey();
  if (!catalogState || catalogState.key !== key) {
    catalogState = {
      key,
      repository: loadCatalogRepository(),
    };
  }
  return catalogState.repository;
}

export function resetCatalogCacheForTests(): void {
  catalogState = undefined;
}

/**
 * A deployment without a catalog fails closed unless operators configure an
 * exact comma-separated ALLOWED_ROUTES list.
 */
export function isFallbackRouteAllowed(routeId: string): boolean {
  const requested = routeId.trim().toUpperCase();
  if (!PRODUCTION_ROUTE_IDS.has(requested)) return false;
  const configured = readFirstNetlifyEnv(['ALLOWED_ROUTES', 'ROUTE_ALLOWLIST']);
  if (configured === undefined) return true;
  return configured
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
    .includes(requested);
}
