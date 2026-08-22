const OSM_TILE_HOST = 'tile.openstreetmap.org';

export interface PrecacheManifestEntry {
  url: string;
  revision: string | null;
}

function requestUrl(input: string | URL | { url: string }): URL {
  if (typeof input === 'string' || input instanceof URL) {
    return new URL(input, globalThis.location?.href ?? 'http://localhost/');
  }
  return new URL(input.url, globalThis.location?.href ?? 'http://localhost/');
}

function isOsmTileUrl(url: URL): boolean {
  return url.hostname === OSM_TILE_HOST || url.hostname.endsWith(`.${OSM_TILE_HOST}`);
}

function isApiPath(pathname: string): boolean {
  return /(?:^|\/)api(?:\/|$)/.test(pathname);
}

function isCatalogPath(pathname: string): boolean {
  return /(?:^|\/)data\/catalog\.json$/.test(pathname);
}

function isAssetsPath(pathname: string): boolean {
  return /(?:^|\/)assets(?:\/|$)/.test(pathname);
}

/** API responses and public OSM tiles must never be served from a service-worker cache. */
export function isNetworkOnlyRequest(input: string | URL | { url: string }): boolean {
  const url = requestUrl(input);
  return isApiPath(url.pathname) || isOsmTileUrl(url);
}

export function getCatalogCacheRevision(
  manifest: readonly PrecacheManifestEntry[],
  fallbackRevision: string,
): string {
  const catalogEntry = manifest.find((entry) => {
    const url = new URL(entry.url, 'http://localhost/');
    return isCatalogPath(url.pathname);
  });
  const revision = catalogEntry?.revision?.trim();
  return revision || fallbackRevision;
}

export function isNavigationRequest(input: { mode?: string }): boolean {
  return input.mode === 'navigate';
}

export function isCacheFirstAssetRequest(input: { url: string; destination?: string }): boolean {
  const url = requestUrl(input);
  if (isNetworkOnlyRequest(url)) {
    return false;
  }
  const destination = input.destination ?? '';
  return isAssetsPath(url.pathname)
    || isCatalogPath(url.pathname)
    || ['script', 'style', 'font', 'image'].includes(destination);
}
