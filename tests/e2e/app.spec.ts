import { expect, test } from '@playwright/test';

const PREFERENCES_KEY = 'macau-bus-pwa:preferences:v1';

test.describe('澳門巴士核心流程', () => {
  test('opens a route, switches direction, and preserves local preferences', async ({ page }) => {
    await page.addInitScript((key) => {
      window.localStorage.setItem(key, JSON.stringify({ version: 1, favorites: ['1'], recent: ['1'], theme: 'light' }));
    }, PREFERENCES_KEY);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '澳門巴士' })).toBeVisible();

    await page.getByRole('button', { name: '路線' }).click();
    await expect(page.getByRole('heading', { name: '所有路線' })).toBeVisible();
    const routeSearch = page.getByRole('searchbox', { name: '搜尋路線' });
    await routeSearch.fill('1');
    const routeButton = page.getByRole('button', { name: /開啟路線 1/ }).first();
    await expect(routeButton).toBeVisible();
    await routeButton.click();

    await expect(page.locator('.route-page')).toBeVisible();
    const directionTabs = page.locator('.direction-tabs button');
    await expect(directionTabs).toHaveCount(2);
    await directionTabs.nth(1).click();
    await expect(directionTabs.nth(1)).toHaveAttribute('aria-selected', 'true');

    await expect.poll(async () => page.evaluate((key) => window.localStorage.getItem(key), PREFERENCES_KEY))
      .toContain('"favorites":["1"]');
  });

  test('keeps the app shell usable after an offline reload without clearing preferences', async ({ page, context }) => {
    await page.addInitScript((key) => {
      window.localStorage.setItem(key, JSON.stringify({ version: 1, favorites: ['1'], recent: [], theme: 'light' }));
    }, PREFERENCES_KEY);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 15_000 });
    await context.setOffline(true);
    await page.reload();

    await expect(page.getByRole('heading', { name: '澳門巴士' })).toBeVisible();
    await expect.poll(async () => page.evaluate((key) => window.localStorage.getItem(key), PREFERENCES_KEY))
      .toContain('"favorites":["1"]');
    await context.setOffline(false);
  });
});
