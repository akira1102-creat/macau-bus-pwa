import { describe, expect, it } from 'vitest';

import { isNetworkOnlyRequest } from './cache-policy';

describe('service worker network policy', () => {
  it.each([
    'http://localhost:4173/api/health',
    'https://tile.openstreetmap.org/12/123/456.png',
    'https://a.tile.openstreetmap.org/12/123/456.png',
  ])('keeps %s network-only', (url) => {
    expect(isNetworkOnlyRequest(url)).toBe(true);
  });

  it.each([
    'http://localhost:4173/assets/index-abc123.js',
    'http://localhost:4173/data/catalog.json',
    'https://example.com/api-not-a-route',
  ])('does not classify %s as a network-only request', (url) => {
    expect(isNetworkOnlyRequest(url)).toBe(false);
  });
});
