import { expect, test, type Page } from '@playwright/test';

const PREFERENCES_KEY = 'macau-bus-pwa:preferences:v1';
const PUSH_KEY = 'macau-bus-pwa:push:v1';
const PARKING_SNAPSHOT = {
  updatedAt: '2026-08-22T10:00:00+08:00',
  stale: false,
  facilities: [
    {
      id: '42',
      name: '甲停車場',
      location: '澳門半島',
      entrance: '東入口',
      latitude: 22.198,
      longitude: 113.543,
      spaces: { car: 12, motorcycle: 4, electricCar: 2, electricMotorcycle: 1, accessible: 1 },
      updatedAt: '2026-08-22T10:00:00+08:00',
      suspended: false,
    },
    {
      id: '43',
      name: '乙停車場',
      location: '氹仔',
      entrance: null,
      latitude: null,
      longitude: null,
      spaces: { car: null, motorcycle: null, electricCar: null, electricMotorcycle: null, accessible: null },
      updatedAt: null,
      suspended: true,
    },
  ],
};

async function mockParkingApi(page: Page): Promise<void> {
  await page.route('**/api/parking', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PARKING_SNAPSHOT) });
  });
  await page.route('**/api/push/parking-alerts**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ alerts: [] }) });
      return;
    }
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'parking-alert-e2e',
          parkingId: '42',
          parkingName: '甲停車場',
          threshold: 10,
        }),
      });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });
}

function setRememberedParkingMode(page: Page): Promise<void> {
  return page.addInitScript(({ preferencesKey, pushKey }) => {
    window.localStorage.setItem(preferencesKey, JSON.stringify({
      version: 3,
      favorites: [],
      recent: [],
      theme: 'light',
      notificationLeadStops: 3,
      activeMode: 'parking',
      parkingFavorites: [],
      parkingAlertThreshold: 10,
    }));
    window.localStorage.setItem(pushKey, JSON.stringify({ subscriptionId: 'e2e-subscription', alertToken: 'e2e-token' }));
    Object.defineProperty(window, 'PushManager', { configurable: true, value: class FakePushManager {} });
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'granted', requestPermission: async () => 'granted' },
    });
  }, { preferencesKey: PREFERENCES_KEY, pushKey: PUSH_KEY }).then(() => undefined);
}

test.use({ serviceWorkers: 'block' });

test.describe('泊車模式整合流程', () => {
  test('first launch chooses parking and remembers the selected mode after reload', async ({ page }) => {
    await mockParkingApi(page);
    await page.addInitScript((key) => {
      if (!window.sessionStorage.getItem('e2e-first-run-seeded')) {
        window.localStorage.removeItem(key);
        window.sessionStorage.setItem('e2e-first-run-seeded', '1');
      }
    }, PREFERENCES_KEY);
    await page.goto('/');

    await expect(page.getByRole('dialog', { name: '選擇使用模式' })).toBeVisible();
    await page.getByRole('button', { name: '搵泊車位' }).click();
    await expect(page).toHaveURL(/mode=parking&tab=nearby/);
    await expect(page.getByRole('heading', { name: '附近泊車位' })).toBeVisible();
    await expect(page.getByText('甲停車場', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('dialog', { name: '選擇使用模式' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '附近泊車位' })).toBeVisible();
    await expect.poll(async () => page.evaluate((key) => window.localStorage.getItem(key), PREFERENCES_KEY))
      .toContain('"activeMode":"parking"');
  });

  test('covers parking navigation, search, favorite, map, detail, navigation, and one-shot alert', async ({ page }) => {
    await setRememberedParkingMode(page);
    await mockParkingApi(page);
    await page.goto('/?mode=parking&tab=nearby');
    await expect(page.getByRole('heading', { name: '附近泊車位' })).toBeVisible();

    await page.getByRole('button', { name: '收藏停車場 甲停車場' }).click();
    await page.getByRole('button', { name: '收藏', exact: true }).click();
    await expect(page.getByRole('heading', { name: '收藏泊車位' })).toBeVisible();
    await expect(page.getByText('甲停車場', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '搜尋', exact: true }).click();
    await page.getByRole('searchbox', { name: '搜尋停車場名稱或位置' }).fill('甲');
    await expect(page.getByRole('button', { name: '開啟停車場 甲停車場' })).toBeVisible();

    await page.getByRole('button', { name: '地圖', exact: true }).click();
    await expect(page.getByRole('heading', { name: '泊車地圖' })).toBeVisible();
    await expect(page.getByRole('button', { name: '選取甲停車場' })).toBeVisible();
    await page.getByRole('button', { name: '選取甲停車場' }).click();
    await expect(page.getByRole('heading', { name: '甲停車場' })).toBeVisible();

    await expect(page.getByRole('button', { name: '導航' })).toBeVisible();
    await page.getByRole('button', { name: '設定低空位提醒' }).click();
    const alertDialog = page.getByRole('dialog', { name: '甲停車場' });
    await expect(alertDialog).toBeVisible();
    await expect(alertDialog.getByRole('spinbutton', { name: '低空位提醒門檻' })).toHaveValue('10');
    await alertDialog.getByRole('button', { name: '開啟低空位提醒' }).click();
    await expect(alertDialog.getByText('已設定低空位提醒。')).toBeVisible();
  });

  test('keeps both mode navigation sets and uses touch-sized quick switches', async ({ page }) => {
    await setRememberedParkingMode(page);
    await mockParkingApi(page);
    await page.goto('/?mode=parking&tab=nearby');
    const parkingSwitch = page.getByRole('button', { name: '切換至泊車模式' });
    const busSwitch = page.getByRole('button', { name: '切換至巴士模式' });
    await expect(parkingSwitch).toBeVisible();
    await expect(busSwitch).toBeVisible();
    expect((await parkingSwitch.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect((await busSwitch.boundingBox())?.height).toBeGreaterThanOrEqual(44);

    await busSwitch.click();
    await expect(page).toHaveURL(/mode=bus&tab=nearby/);
    await expect(page.getByRole('heading', { name: '附近巴士站' })).toBeVisible();
    await page.getByRole('button', { name: '切換至泊車模式' }).click();
    await expect(page).toHaveURL(/mode=parking&tab=nearby/);
    await expect(page.getByRole('heading', { name: '附近泊車位' })).toBeVisible();
  });
});
