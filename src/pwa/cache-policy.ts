const OSM_TILE_HOST = 'tile.openstreetmap.org';

function requestUrl(input: string | URL | { url: string }): URL {
  if (typeof input === 'string' || input instanceof URL) {
    return new URL(input, globalThis.location?.href ?? 'http://localhost/');
  }
  return new URL(input.url, globalThis.location?.href ?? 'http://localhost/');
}

function isOsmTileUrl(url: URL): boolean {
  return url.hostname === OSM_TILE_HOST || url.hostname.endsWith(`.${OSM_TILE_HOST}`);
}

/** API responses and public OSM tiles must never be served from a service-worker cache. */
export function isNetworkOnlyRequest(input: string | URL | { url: string }): boolean {
  const url = requestUrl(input);
  return url.pathname.startsWith('/api/') || isOsmTileUrl(url);
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
  return url.pathname.startsWith('/assets/')
    || url.pathname.endsWith('/data/catalog.json')
    || ['script', 'style', 'font', 'image'].includes(destination);
}
