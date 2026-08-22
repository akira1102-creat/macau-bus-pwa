import { describe, expect, it, vi } from 'vitest';

import { handleNotificationClick, handlePushEvent } from './push-handlers';

describe('service worker push handlers', () => {
  it('shows a notification from a push payload', async () => {
    const showNotification = vi.fn().mockResolvedValue(undefined);
    await handlePushEvent({
      data: { json: () => ({ title: '巴士快到了', body: '路線 1 · 仲有 2 站', url: '/macau-bus-pwa/?tab=routes&route=1' }) },
      registration: { showNotification },
    });

    expect(showNotification).toHaveBeenCalledWith('巴士快到了', expect.objectContaining({ body: '路線 1 · 仲有 2 站', data: { url: '/macau-bus-pwa/?tab=routes&route=1' } }));
  });

  it('renders the checker payload fields when the backend body is absent', async () => {
    const showNotification = vi.fn().mockResolvedValue(undefined);
    await handlePushEvent({
      data: { json: () => ({
        route: '1', direction: 0, stop: 'M2', plate: 'PLATE-002', remainingStops: 0,
        url: 'https://example.test/macau-bus-pwa/?tab=routes&route=1&direction=0',
      }) },
      registration: { showNotification },
    });

    expect(showNotification).toHaveBeenCalledWith('澳門巴士到站提醒', expect.objectContaining({
      body: '路線 1 方向 0，站點 M2，車牌 PLATE-002，尚餘 0 站',
      data: { url: 'https://example.test/macau-bus-pwa/?tab=routes&route=1&direction=0' },
    }));
  });

  it('falls back to a safe generic body for malformed checker details', async () => {
    const showNotification = vi.fn().mockResolvedValue(undefined);
    await handlePushEvent({
      data: { json: () => ({
        body: { private: 'detail' }, route: { private: 'route' }, direction: '0', stop: null,
        plate: { private: 'plate' }, remainingStops: '0',
      }) },
      registration: { showNotification },
    });

    expect(showNotification).toHaveBeenCalledWith('澳門巴士到站提醒', expect.objectContaining({ body: '有一則到站提醒。' }));
    expect(showNotification.mock.calls[0]?.[1]?.body).not.toContain('[object Object]');
  });

  it('focuses an existing app client for notification clicks', async () => {
    const focus = vi.fn().mockResolvedValue(undefined);
    const openWindow = vi.fn();
    await handleNotificationClick({
      notification: { data: { url: '/macau-bus-pwa/?tab=routes&route=1' }, close: vi.fn() },
      clients: {
        matchAll: vi.fn().mockResolvedValue([{ url: 'https://example.test/macau-bus-pwa/', focus }]),
        openWindow,
      },
      scope: 'https://example.test/macau-bus-pwa/',
    });

    expect(focus).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('opens the deep link when no app client exists', async () => {
    const openWindow = vi.fn().mockResolvedValue(undefined);
    await handleNotificationClick({
      notification: { data: { url: '/macau-bus-pwa/?tab=settings' }, close: vi.fn() },
      clients: { matchAll: vi.fn().mockResolvedValue([]), openWindow },
      scope: 'https://example.test/macau-bus-pwa/',
    });

    expect(openWindow).toHaveBeenCalledWith('https://example.test/macau-bus-pwa/?tab=settings');
  });
});
