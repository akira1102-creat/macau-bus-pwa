import { expect, test } from '@playwright/test';

import { createUpdateFixtureServer } from './update-fixture-server';

test.describe('real service-worker update handoff', () => {
  test('activates changed worker, reloads once, and preserves localStorage', async ({ page }) => {
    const fixtureServer = await createUpdateFixtureServer();
    const preferencesKey = 'macau-bus-pwa:preferences:v1';
    let mainFrameNavigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        mainFrameNavigations += 1;
      }
    });

    try {
      await page.addInitScript((key) => {
        window.localStorage.setItem(key, JSON.stringify({ version: 1, favorites: ['1'], recent: ['1'], theme: 'light' }));
      }, preferencesKey);
      await page.goto(fixtureServer.url);
      await expect(page.getByRole('heading', { name: '澳門巴士' })).toBeVisible();
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 15_000 });
      const navigationsBeforeUpdate = mainFrameNavigations;

      await fixtureServer.setWorkerRelease('fixture-v2');
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        await registration.update();
      }).catch(() => undefined);

      await expect.poll(() => mainFrameNavigations, { timeout: 15_000 }).toBe(navigationsBeforeUpdate + 1);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
      expect(mainFrameNavigations).toBe(navigationsBeforeUpdate + 1);
      await expect.poll(async () => page.evaluate((key) => window.localStorage.getItem(key), preferencesKey))
        .toContain('"favorites":["1"]');
    } finally {
      await fixtureServer.close();
    }
  });
});
