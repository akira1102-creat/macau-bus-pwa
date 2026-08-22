import { describe, expect, it } from 'vitest';

import { getCatalogCacheRevision, isCacheFirstAssetRequest, isNetworkOnlyRequest } from './cache-policy';

describe('service worker network policy', () => {
  it.each([
    'http://localhost:4173/api',
    'http://localhost:4173/api/health',
    'http://localhost:4173/api?probe=1',
    'http://localhost:4173/macau-bus-pwa/api',
    'http://localhost:4173/macau-bus-pwa/api/health',
    'http://localhost:4173/macau-bus-pwa/api?probe=1',
    'https://tile.openstreetmap.org/12/123/456.png',
    'https://a.tile.openstreetmap.org/12/123/456.png',
  ])('keeps %s network-only', (url) => {
    expect(isNetworkOnlyRequest(url)).toBe(true);
  });

  it.each([
    'http://localhost:4173/assets/index-abc123.js',
    'http://localhost:4173/macau-bus-pwa/assets/index-abc123.js',
    'http://localhost:4173/data/catalog.json',
    'http://localhost:4173/macau-bus-pwa/data/catalog.json',
    'https://example.com/api-not-a-route',
  ])('does not classify %s as a network-only request', (url) => {
    expect(isNetworkOnlyRequest(url)).toBe(false);
  });

  it('uses the build-time catalog revision for runtime cache identity', () => {
    expect(getCatalogCacheRevision([
      { url: '/assets/app.js', revision: 'app-rev' },
      { url: '/data/catalog.json', revision: 'catalog-rev-1' },
    ], 'macau-bus-pwa-v0.2.4')).toBe('catalog-rev-1');
    expect(getCatalogCacheRevision([
      { url: '/data/catalog.json', revision: null },
    ], 'macau-bus-pwa-v0.2.4')).toBe('macau-bus-pwa-v0.2.4');
    expect(getCatalogCacheRevision([
      { url: '/macau-bus-pwa/data/catalog.json', revision: 'catalog-pages-rev' },
    ], 'macau-bus-pwa-v0.2.4')).toBe('catalog-pages-rev');
  });

  it('recognizes hashed assets below a project Pages base path', () => {
    expect(isCacheFirstAssetRequest({
      url: 'http://localhost:4173/macau-bus-pwa/assets/index-abc123.js',
      destination: 'script',
    })).toBe(true);
  });
});
