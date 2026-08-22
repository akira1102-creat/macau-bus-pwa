import { expect, test, type Page } from '@playwright/test';

const REALTIME_UPDATED_AT = '2026-08-22T00:00:00.000Z';
const ROUTE_PLATE = 'E2E-ROUTE-PLATE-001';
const NEARBY_PLATE = 'E2E-NEARBY-PLATE-001';
const PREFERENCES_KEY = 'macau-bus-pwa:preferences:v1';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    if (!window.localStorage.getItem(key)) {
      window.localStorage.setItem(key, JSON.stringify({
        version: 3,
        favorites: [],
        recent: [],
        theme: 'light',
        notificationLeadStops: 3,
        activeMode: 'bus',
        parkingFavorites: [],
        parkingAlertThreshold: 10,
      }));
    }
  }, PREFERENCES_KEY);
});

async function mockRouteRealtime(page: Page, plate = ROUTE_PLATE): Promise<void> {
  await page.route('**/api/bus/realtime/1/**', async (route) => {
    const url = new URL(route.request().url());
    const direction = url.pathname.endsWith('/1') ? 1 : 0;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        route: '1',
        direction,
        updatedAt: REALTIME_UPDATED_AT,
        ageSeconds: 0,
        stale: false,
        source: 'DSAT observation',
        buses: [{
          plate,
          stationCode: 'M1/5',
          speedKph: 12,
          status: null,
          passengerFlow: null,
          busType: null,
          facilities: null,
        }],
      }),
    });
  });
}

test.describe('Task 6 route and reminder flows', () => {
  test('opens on stops, keeps stops left of realtime, shows full plate, and opens the three-stop reminder sheet', async ({ page }) => {
    await mockRouteRealtime(page);
    await page.goto('/?tab=routes&route=1');

    const routePage = page.locator('.route-page');
    await expect(routePage).toBeVisible();
    const dataTabs = routePage.locator('.route-data-tabs [role="tab"]');
    await expect(dataTabs).toHaveText(['站點', '實時巴士']);
    await expect(dataTabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(dataTabs.nth(1)).toHaveAttribute('aria-selected', 'false');
    await expect(routePage.getByText(ROUTE_PLATE, { exact: true })).toBeVisible();

    await routePage.getByRole('button', { name: /設定 .* 到站提醒/ }).first().click();
    const sheet = page.getByRole('dialog', { name: '設定到站提醒' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('提前 3 站')).toBeVisible();
    await expect(sheet.getByRole('button', { name: '設定一次性提醒' })).toBeVisible();
  });

  test('keeps the default lead count and saves the full 1–10 settings range', async ({ page }) => {
    await page.goto('/?tab=settings');

    const defaultOption = page.getByRole('radio', { name: '提前 3 站' });
    await expect(defaultOption).toBeChecked();
    await page.getByRole('radio', { name: '提前 1 站' }).check();
    await expect(page.getByRole('radio', { name: '提前 1 站' })).toBeChecked();
    await page.getByRole('radio', { name: '提前 10 站' }).check();
    await expect(page.getByRole('radio', { name: '提前 10 站' })).toBeChecked();

    await page.reload();
    await expect(page.getByRole('radio', { name: '提前 10 站' })).toBeChecked();
  });
});

test.describe('Task 6 nearby arrivals flow', () => {
  test('renders mocked remaining stops and opens the returned direction', async ({ page }) => {
    await page.context().grantPermissions(['geolocation']);
    await page.context().setGeolocation({ latitude: 22.215201, longitude: 113.549194 });
    await page.route('**/api/bus/arrivals', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          updatedAt: REALTIME_UPDATED_AT,
          arrivals: [{
            stopId: 'M1/5',
            route: '1',
            direction: 1,
            plate: NEARBY_PLATE,
            remainingStops: 2,
          }],
        }),
      });
    });
    await mockRouteRealtime(page, NEARBY_PLATE);
    await page.goto('/');

    await page.getByRole('button', { name: '使用目前位置' }).click();
    await expect(page.getByText(NEARBY_PLATE, { exact: true })).toBeVisible();
    await expect(page.getByText('仲有 2 站', { exact: true })).toBeVisible();

    const arrival = page.getByRole('button', { name: new RegExp(`開啟路線 1 .*${NEARBY_PLATE}`) });
    await expect(arrival).toBeVisible();
    await arrival.click();
    await expect(page).toHaveURL(/tab=routes&route=1&direction=1/);
    await expect(page.locator('.route-heading p')).toHaveText('媽閣 ⇀ 關閘');
  });
});
