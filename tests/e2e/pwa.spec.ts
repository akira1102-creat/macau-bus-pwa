import { expect, test } from '@playwright/test';

test.describe('PWA release surface', () => {
  test('serves a standalone manifest with real PNG icons', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.ok()).toBe(true);
    const manifest = await response.json() as {
      display: string;
      start_url: string;
      scope: string;
      icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
    };
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }),
      expect.objectContaining({ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }),
      expect.objectContaining({ src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }),
    ]));

    for (const icon of manifest.icons) {
      const iconResponse = await request.get(icon.src);
      expect(iconResponse.ok()).toBe(true);
      expect(iconResponse.headers()['content-type']).toContain('image/png');
      expect((await iconResponse.body()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    }
  });

  test('serves one versioned worker with the required network and update markers', async ({ request }) => {
    const response = await request.get('/sw.js');
    expect(response.ok()).toBe(true);
    const worker = await response.text();
    expect(worker).toContain('skipWaiting');
    expect(worker).toContain('clients.claim');
    expect(worker).toContain('NetworkFirst');
    expect(worker).toContain('NetworkOnly');
    expect(worker).toContain('macau-bus-pwa-v0.2.1');
  });

  test('runs an update check without clearing local preferences', async ({ page }) => {
    const key = 'macau-bus-pwa:preferences:v1';
    await page.addInitScript((storageKey) => {
      window.localStorage.setItem(storageKey, JSON.stringify({ version: 1, favorites: ['1'], recent: [], theme: 'light' }));
    }, key);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 15_000 });
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
    });
    await expect.poll(async () => page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key))
      .toContain('"favorites":["1"]');
  });

  test('does not serve an API response from the service-worker cache', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 15_000 });
    await expect.poll(async () => page.evaluate(async () => (await fetch('/api/health')).status)).toBe(200);

    await context.setOffline(true);
    const offlineResult = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/health');
        return { ok: true, status: response.status };
      } catch {
        return { ok: false, status: 0 };
      }
    });
    await context.setOffline(false);
    expect(offlineResult).toEqual({ ok: false, status: 0 });
  });
});
