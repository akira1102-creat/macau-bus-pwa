/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, NetworkOnly } from 'workbox-strategies';

import { isCacheFirstAssetRequest, isNavigationRequest, isNetworkOnlyRequest } from './pwa/cache-policy';
import { APP_RELEASE } from './pwa/release';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const CACHE_PREFIX = 'macau-bus-pwa';
const NAVIGATION_CACHE = `${CACHE_PREFIX}-navigation-${APP_RELEASE}`;
const ASSET_CACHE = `${CACHE_PREFIX}-assets-${APP_RELEASE}`;
const CATALOG_CACHE = `${CACHE_PREFIX}-catalog-${APP_RELEASE}`;

const precacheManifest = (self.__WB_MANIFEST ?? []).filter((entry) => {
  const url = typeof entry === 'string' ? entry : entry.url;
  const pathname = new URL(url, self.location.origin).pathname;
  return !pathname.endsWith('/index.html') && !pathname.endsWith('/data/catalog.json');
});

precacheAndRoute(precacheManifest);
cleanupOutdatedCaches();
clientsClaim();

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((name) => name.startsWith(`${CACHE_PREFIX}-`) && !name.endsWith(APP_RELEASE))
        .map((name) => caches.delete(name)),
    )),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

registerRoute(
  ({ request }) => isNetworkOnlyRequest(request),
  new NetworkOnly(),
);

registerRoute(
  ({ request }) => isNavigationRequest(request),
  new NetworkFirst({ cacheName: NAVIGATION_CACHE, networkTimeoutSeconds: 3 }),
);

registerRoute(
  ({ url }) => url.pathname.endsWith('/data/catalog.json'),
  new CacheFirst({ cacheName: CATALOG_CACHE }),
);

registerRoute(
  ({ request }) => isCacheFirstAssetRequest(request),
  new CacheFirst({ cacheName: ASSET_CACHE }),
);
