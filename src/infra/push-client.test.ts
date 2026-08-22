import { describe, expect, it, vi } from 'vitest';

import { createPushClient, PUSH_IDENTITY_STORAGE_KEY, type PushClientError, type PushIdentity, type PreferencesStorage } from './push-client';

class MemoryStorage implements PreferencesStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function pushManager(subscribe: ReturnType<typeof vi.fn>) {
  return { subscribe } as unknown as PushManager;
}

function registration(pushManagerValue: PushManager) {
  return { pushManager: pushManagerValue } as unknown as ServiceWorkerRegistration;
}

function notification(permission: NotificationPermission = 'granted') {
  return {
    permission,
    requestPermission: vi.fn(async () => permission),
  } as unknown as Pick<typeof Notification, 'permission' | 'requestPermission'>;
}

function identity(): PushIdentity {
  return { subscriptionId: 'sub-1', alertToken: 'token-1' };
}

describe('browser push client', () => {
  it('reports an unsupported state without touching the network', async () => {
    const fetcher = vi.fn();
    const client = createPushClient({ fetch: fetcher });

    expect(client.support()).toMatchObject({ supported: false });
    await expect(client.listAlerts()).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not create an alert when notification permission is denied', async () => {
    const fetcher = vi.fn();
    const subscribe = vi.fn();
    const client = createPushClient({
      fetch: fetcher,
      serviceWorker: { ready: Promise.resolve(registration(pushManager(subscribe))) },
      pushManager: pushManager(subscribe),
      notification: notification('denied'),
      storage: new MemoryStorage(),
    });

    await expect(client.createAlert({ routeId: '1', direction: 0, targetStopId: 'A', targetStopIndex: 0, threshold: 3 }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('subscribes through the service worker and keeps push identity in its own storage key', async () => {
    const storage = new MemoryStorage();
    const subscribe = vi.fn().mockResolvedValue({
      endpoint: 'https://push.example/subscription',
      toJSON: () => ({ endpoint: 'https://push.example/subscription', keys: { p256dh: 'key', auth: 'auth' } }),
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ publicKey: 'BElongPublicKey' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(identity()), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'alert-1', routeId: '1', direction: 0, targetStopId: 'A', targetStopIndex: 0, threshold: 3 }), { status: 201 }));
    const client = createPushClient({
      fetch: fetcher,
      storage,
      serviceWorker: { ready: Promise.resolve(registration(pushManager(subscribe))) },
      pushManager: pushManager(subscribe),
      notification: notification('granted'),
    });

    await client.createAlert({ routeId: '1', direction: 0, targetStopId: 'A', targetStopIndex: 0, threshold: 3 });

    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.any(ArrayBuffer) }));
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/push/subscriptions', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ endpoint: 'https://push.example/subscription', keys: { p256dh: 'key', auth: 'auth' } }),
    }));
    expect(JSON.parse(storage.getItem(PUSH_IDENTITY_STORAGE_KEY) ?? '{}')).toEqual(identity());
  });

  it('uses the stored bearer identity for list, create and delete operations', async () => {
    const storage = new MemoryStorage();
    storage.setItem(PUSH_IDENTITY_STORAGE_KEY, JSON.stringify(identity()));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ alerts: [{ id: 'alert-1', routeId: '1', direction: 0, targetStopId: 'A', targetStopIndex: 0, threshold: 3 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'alert-2', routeId: '1', direction: 0, targetStopId: 'B', targetStopIndex: 1, threshold: 2 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createPushClient({ fetch: fetcher, storage, notification: notification('granted'), pushManager: pushManager(vi.fn()), serviceWorker: { ready: Promise.resolve(registration(pushManager(vi.fn()))) } });

    await expect(client.listAlerts()).resolves.toHaveLength(1);
    await client.createAlert({ routeId: '1', direction: 0, targetStopId: 'B', targetStopIndex: 1, threshold: 2 });
    await client.deleteAlert('alert-2');

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/push/alerts', expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer token-1' }) }));
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/push/alerts', expect.objectContaining({ method: 'POST', body: JSON.stringify({ routeId: '1', direction: 0, targetStopId: 'B', targetStopIndex: 1, threshold: 2 }) }));
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/push/alerts/alert-2', expect.objectContaining({ method: 'DELETE', headers: expect.objectContaining({ Authorization: 'Bearer token-1' }) }));
  });

  it('uses the same stored push identity for parking alert list/create/delete operations', async () => {
    const storage = new MemoryStorage();
    storage.setItem(PUSH_IDENTITY_STORAGE_KEY, JSON.stringify(identity()));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ alerts: [{ id: 'parking-alert-1', parkingId: '42', parkingName: '甲停車場', threshold: 10 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'parking-alert-2', parkingId: '43', parkingName: '乙停車場', threshold: 7 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createPushClient({ fetch: fetcher, storage, notification: notification('granted'), pushManager: pushManager(vi.fn()), serviceWorker: { ready: Promise.resolve(registration(pushManager(vi.fn()))) } });

    await expect(client.listParkingAlerts?.()).resolves.toEqual([{ id: 'parking-alert-1', parkingId: '42', parkingName: '甲停車場', threshold: 10 }]);
    await expect(client.createParkingAlert?.({ parkingId: '43', parkingName: '乙停車場', threshold: 7 })).resolves.toMatchObject({ parkingId: '43' });
    await client.deleteParkingAlert?.('parking-alert-2');

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/push/parking-alerts', expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer token-1' }) }));
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/push/parking-alerts', expect.objectContaining({ method: 'POST', body: JSON.stringify({ parkingId: '43', parkingName: '乙停車場', threshold: 7 }) }));
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/push/parking-alerts/parking-alert-2', expect.objectContaining({ method: 'DELETE', headers: expect.objectContaining({ Authorization: 'Bearer token-1' }) }));
  });

  it('does not create a parking alert when permission is denied', async () => {
    const fetcher = vi.fn();
    const client = createPushClient({
      fetch: fetcher,
      serviceWorker: { ready: Promise.resolve(registration(pushManager(vi.fn()))) },
      pushManager: pushManager(vi.fn()),
      notification: notification('denied'),
      storage: new MemoryStorage(),
    });

    await expect(client.createParkingAlert?.({ parkingId: '42', parkingName: '甲停車場', threshold: 10 }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([404, 410])('keeps a valid identity after an alert-level %s and can still manage another alert', async (status) => {
    const storage = new MemoryStorage();
    storage.setItem(PUSH_IDENTITY_STORAGE_KEY, JSON.stringify(identity()));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ alerts: [{ id: 'alert-1', routeId: '1', direction: 0, targetStopId: 'A', targetStopIndex: 0, threshold: 3 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createPushClient({
      fetch: fetcher,
      storage,
      notification: notification('granted'),
      pushManager: pushManager(vi.fn()),
      serviceWorker: { ready: Promise.resolve(registration(pushManager(vi.fn()))) },
    });

    await expect(client.deleteAlert('missing-alert')).rejects.toMatchObject({ code: 'http', status });
    expect(storage.getItem(PUSH_IDENTITY_STORAGE_KEY)).toBe(JSON.stringify(identity()));
    await expect(client.listAlerts()).resolves.toEqual([{
      id: 'alert-1', routeId: '1', direction: 0, targetStopId: 'A', targetStopIndex: 0, threshold: 3,
    }]);
    await expect(client.deleteAlert('alert-1')).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('clears a stale stored identity after an authenticated 401 response and resubscribes on the next explicit action', async () => {
    const status = 401;
    const storage = new MemoryStorage();
    storage.setItem(PUSH_IDENTITY_STORAGE_KEY, JSON.stringify(identity()));
    const subscribe = vi.fn().mockResolvedValue({
      endpoint: 'https://push.example/subscription-2',
      toJSON: () => ({ endpoint: 'https://push.example/subscription-2', keys: { p256dh: 'key-2', auth: 'auth-2' } }),
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ publicKey: 'BElongPublicKey' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(identity()), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'alert-2', routeId: '1', direction: 0, targetStopId: 'A', targetStopIndex: 0, threshold: 3 }), { status: 201 }));
    const client = createPushClient({
      fetch: fetcher,
      storage,
      serviceWorker: { ready: Promise.resolve(registration(pushManager(subscribe))) },
      pushManager: pushManager(subscribe),
      notification: notification('granted'),
    });

    await expect(client.listAlerts()).rejects.toMatchObject({ code: 'http', status });
    expect(storage.getItem(PUSH_IDENTITY_STORAGE_KEY)).toBeNull();

    await expect(client.createAlert({ routeId: '1', direction: 0, targetStopId: 'A', targetStopIndex: 0, threshold: 3 }))
      .resolves.toMatchObject({ id: 'alert-2' });
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/push/public-key', expect.objectContaining({ method: 'GET' }));
  });

  it.each([
    ['iPhone', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5, standalone: false }],
    ['iPad desktop mode', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5, standalone: false }],
  ])('requires %s to be launched from the home screen', (_label, platform) => {
    const client = createPushClient({
      notification: notification('default'),
      pushManager: pushManager(vi.fn()),
      serviceWorker: { ready: Promise.resolve(registration(pushManager(vi.fn()))) },
      platform,
    });

    expect(client.support()).toEqual({ supported: false, permission: 'default', reason: 'ios-not-standalone' });
  });

  it('allows iOS push when the PWA is running standalone', () => {
    const client = createPushClient({
      notification: notification('default'),
      pushManager: pushManager(vi.fn()),
      serviceWorker: { ready: Promise.resolve(registration(pushManager(vi.fn()))) },
      platform: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5, standalone: true },
    });

    expect(client.support()).toEqual({ supported: true, permission: 'default' });
  });

  it('prefetches public key and service worker registration without prompting or subscribing', async () => {
    const requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
    const subscribe = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ publicKey: 'BElongPublicKey' }), { status: 200 }));
    const client = createPushClient({
      fetch: fetcher,
      notification: { permission: 'default', requestPermission },
      pushManager: pushManager(subscribe),
      serviceWorker: { ready: Promise.resolve(registration(pushManager(subscribe))) },
    });

    expect(client.prepare).toBeTypeOf('function');
    await client.prepare!();

    expect(fetcher).toHaveBeenCalledWith('/api/push/public-key', expect.objectContaining({ method: 'GET' }));
    expect(requestPermission).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('requests permission and subscribes only when an explicit create follows prefetch', async () => {
    const requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
    const subscribe = vi.fn().mockResolvedValue({
      endpoint: 'https://push.example/subscription-explicit',
      toJSON: () => ({ endpoint: 'https://push.example/subscription-explicit', keys: { p256dh: 'key', auth: 'auth' } }),
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ publicKey: 'BElongPublicKey' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(identity()), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'alert-explicit', routeId: '1', direction: 0, targetStopId: 'A', targetStopIndex: 0, threshold: 3 }), { status: 201 }));
    const client = createPushClient({
      fetch: fetcher,
      notification: { permission: 'default', requestPermission },
      pushManager: pushManager(subscribe),
      serviceWorker: { ready: Promise.resolve(registration(pushManager(subscribe))) },
    });

    await client.prepare!();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();

    await client.createAlert({ routeId: '1', direction: 0, targetStopId: 'A', targetStopIndex: 0, threshold: 3 });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('turns network failures into safe typed errors without exposing response details', async () => {
    const storage = new MemoryStorage();
    storage.setItem(PUSH_IDENTITY_STORAGE_KEY, JSON.stringify(identity()));
    const client = createPushClient({
      fetch: vi.fn().mockRejectedValue(new Error('private endpoint detail')),
      storage,
      notification: notification('granted'),
      pushManager: pushManager(vi.fn()),
      serviceWorker: { ready: Promise.resolve(registration(pushManager(vi.fn()))) },
    });

    await expect(client.listAlerts()).rejects.toMatchObject({ name: 'PushClientError', code: 'network' } satisfies Partial<PushClientError>);
    await expect(client.listAlerts()).rejects.not.toThrow('private endpoint detail');
  });
});
