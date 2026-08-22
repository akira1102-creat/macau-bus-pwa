/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, NetworkOnly } from 'workbox-strategies';

import {
  getCatalogCacheRevision,
  isCacheFirstAssetRequest,
  isNavigationRequest,
  isNetworkOnlyRequest,
} from './pwa/cache-policy';
import { APP_RELEASE } from './pwa/release';
import { handleNotificationClick, handlePushEvent } from './pwa/push-handlers';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const CACHE_PREFIX = 'macau-bus-pwa';
const NAVIGATION_CACHE = `${CACHE_PREFIX}-navigation-${APP_RELEASE}`;
const ASSET_CACHE = `${CACHE_PREFIX}-assets-${APP_RELEASE}`;
const injectedManifest = self.__WB_MANIFEST ?? [];
const CATALOG_REVISION = getCatalogCacheRevision(injectedManifest, APP_RELEASE);
const CATALOG_CACHE = `${CACHE_PREFIX}-catalog-${APP_RELEASE}-${CATALOG_REVISION}`;
const CURRENT_RUNTIME_CACHES = new Set([NAVIGATION_CACHE, ASSET_CACHE, CATALOG_CACHE]);

async function cacheOfflineShell(): Promise<void> {
  const shellUrls = [
    self.registration.scope,
    new URL('index.html', self.registration.scope).toString(),
  ];
  const cache = await caches.open(NAVIGATION_CACHE);
  await Promise.all(shellUrls.map(async (shellUrl) => {
    const response = await fetch(new Request(shellUrl, { cache: 'reload' }));
    if (!response.ok) {
      throw new Error(`offline shell request failed: ${response.status}`);
    }
    await cache.put(shellUrl, response);
  }));
}

const offlineShellFallbackPlugin = {
  async handlerDidError(): Promise<Response> {
    return await caches.match(self.registration.scope) ?? Response.error();
  },
};

const precacheManifest = injectedManifest.filter((entry) => {
  const url = typeof entry === 'string' ? entry : entry.url;
  const pathname = new URL(url, self.location.origin).pathname;
  return !pathname.endsWith('/index.html') && !pathname.endsWith('/data/catalog.json');
});

precacheAndRoute(precacheManifest);
cleanupOutdatedCaches();
clientsClaim();

self.addEventListener('install', (event) => {
  event.waitUntil(Promise.all([
    cacheOfflineShell(),
    self.skipWaiting(),
  ]));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((name) => name.startsWith(`${CACHE_PREFIX}-`) && !CURRENT_RUNTIME_CACHES.has(name))
        .map((name) => caches.delete(name)),
    )),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

self.addEventListener('push', (event) => {
  event.waitUntil(handlePushEvent({ data: event.data, registration: self.registration }));
});

self.addEventListener('notificationclick', (event) => {
  event.waitUntil(handleNotificationClick({
    notification: event.notification,
    clients: self.clients,
    scope: self.registration.scope,
  }));
});

registerRoute(
  ({ request }) => isNetworkOnlyRequest(request),
  new NetworkOnly(),
);

registerRoute(
  ({ request }) => isNavigationRequest(request),
  new NetworkFirst({
    cacheName: NAVIGATION_CACHE,
    networkTimeoutSeconds: 3,
    plugins: [offlineShellFallbackPlugin],
  }),
);

registerRoute(
  ({ url }) => url.pathname.endsWith('/data/catalog.json'),
  new CacheFirst({ cacheName: CATALOG_CACHE }),
);

registerRoute(
  ({ request }) => isCacheFirstAssetRequest(request),
  new CacheFirst({ cacheName: ASSET_CACHE }),
);
