import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPushSubscriptionsHandler } from '../../netlify/functions/push-subscriptions';
import { createParkingPushAlertsHandler } from '../../netlify/functions/push-parking-alerts';
import type {
  JsonBlobStore,
  PushApiDependencies,
  PushReservation,
  StoredParkingAlert,
  StoredSubscription,
} from '../../netlify/functions/_shared/push-store';

const allowedOrigin = 'https://akira1102-creat.github.io';

class MemoryBlobStore<T extends { id: string }> implements JsonBlobStore<T> {
  readonly values = new Map<string, T>();
  private readonly versions = new Map<string, number>();

  async get(key: string): Promise<T | undefined> { return this.values.get(key); }
  async getWithMetadata(key: string): Promise<{ value: T; etag?: string } | undefined> {
    const value = this.values.get(key);
    return value === undefined ? undefined : { value, etag: String(this.versions.get(key) ?? 0) };
  }
  async set(key: string, value: T): Promise<void> {
    this.values.set(key, value);
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
  }
  async setIfNew(key: string, value: T): Promise<boolean> {
    if (this.values.has(key)) return false;
    await this.set(key, value);
    return true;
  }
  async setIfMatch(key: string, value: T, etag: string): Promise<boolean> {
    if (!this.values.has(key) || String(this.versions.get(key) ?? 0) !== etag) return false;
    await this.set(key, value);
    return true;
  }
  async delete(key: string): Promise<void> {
    this.values.delete(key);
    this.versions.delete(key);
  }
  async list(prefix?: string): Promise<string[]> {
    return [...this.values.keys()].filter((key) => prefix === undefined || key.startsWith(prefix));
  }
}

type PushContext = Parameters<ReturnType<typeof createPushSubscriptionsHandler>>[1];

let subscriptions: MemoryBlobStore<StoredSubscription>;
let alerts: MemoryBlobStore<StoredParkingAlert>;
let reservations: MemoryBlobStore<PushReservation>;
let dependencies: PushApiDependencies;
let now: Date;

function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://function.example${path}`, {
    method,
    headers: {
      Origin: allowedOrigin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

function context(alertId?: string): PushContext {
  return { params: alertId === undefined ? {} : { alertId } } as unknown as PushContext;
}

function auth(identity: { subscriptionId: string; alertToken: string }): Record<string, string> {
  return { Authorization: `Bearer ${identity.alertToken}`, 'X-Subscription-Id': identity.subscriptionId };
}

beforeEach(() => {
  now = new Date('2026-08-22T00:00:00.000Z');
  subscriptions = new MemoryBlobStore<StoredSubscription>();
  alerts = new MemoryBlobStore<StoredParkingAlert>();
  reservations = new MemoryBlobStore<PushReservation>();
  dependencies = {
    stores: { subscriptions, alerts: new MemoryBlobStore(), reservations, parkingAlerts: alerts },
    now: () => new Date(now),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parking push alert API', () => {
  it('handles CORS/methods with no-store and authenticates the shared capability', async () => {
    const handler = createParkingPushAlertsHandler(dependencies);
    expect((await handler(request('/api/push/parking-alerts', 'OPTIONS'), context())).status).toBe(204);
    const method = await handler(request('/api/push/parking-alerts', 'PUT'), context());
    expect(method.status).toBe(405);
    expect(method.headers.get('cache-control')).toBe('no-store');
    const unauthorized = await handler(request('/api/push/parking-alerts'), context());
    expect(unauthorized.status).toBe(401);
  });

  it('creates, replaces one facility, lists, expires and deletes alerts with a 12-hour/10-active policy', async () => {
    const subscriptionsHandler = createPushSubscriptionsHandler(dependencies);
    const response = await subscriptionsHandler(request('/api/push/subscriptions', 'POST', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/parking-subscription',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    }), {} as PushContext);
    const identity = await response.json() as { subscriptionId: string; alertToken: string };
    const handler = createParkingPushAlertsHandler(dependencies);
    const headers = auth(identity);

    const first = await handler(request('/api/push/parking-alerts', 'POST', {
      parkingId: '42', parkingName: '甲停車場', threshold: 10,
    }, headers), context());
    expect(first.status).toBe(201);
    const firstSummary = await first.json() as { id: string; expiresAt: string };
    expect(firstSummary.expiresAt).toBe('2026-08-22T12:00:00.000Z');

    const replacement = await handler(request('/api/push/parking-alerts', 'POST', {
      parkingId: '42', parkingName: '甲停車場', threshold: 7,
    }, headers), context());
    expect(replacement.status).toBe(201);
    const replacementSummary = await replacement.json() as { id: string; threshold: number };
    expect(replacementSummary.id).not.toBe(firstSummary.id);
    expect(replacementSummary.threshold).toBe(7);

    for (let index = 0; index < 9; index += 1) {
      expect((await handler(request('/api/push/parking-alerts', 'POST', {
        parkingId: String(index + 1), parkingName: `停車場 ${index + 1}`, threshold: 1,
      }, headers), context())).status).toBe(201);
    }
    expect((await handler(request('/api/push/parking-alerts', 'POST', {
      parkingId: 'overflow', parkingName: '超額停車場', threshold: 1,
    }, headers), context())).status).toBe(409);

    now = new Date('2026-08-22T12:00:00.001Z');
    const listed = await handler(request('/api/push/parking-alerts', 'GET', undefined, headers), context());
    expect(listed.status).toBe(200);
    expect((await listed.json() as { alerts: unknown[] }).alerts).toHaveLength(0);

    now = new Date('2026-08-22T00:00:00.000Z');
    const recreated = await handler(request('/api/push/parking-alerts', 'POST', {
      parkingId: '99', parkingName: '乙停車場', threshold: 1,
    }, headers), context());
    const summary = await recreated.json() as { id: string };
    const deleted = await handler(request(`/api/push/parking-alerts/${summary.id}`, 'DELETE', undefined, headers), context(summary.id));
    expect(deleted.status).toBe(200);
    expect(await alerts.list()).toHaveLength(0);
  });

  it('rejects invalid thresholds and never exposes capability secrets in stored records', async () => {
    const subscriptionsHandler = createPushSubscriptionsHandler(dependencies);
    const response = await subscriptionsHandler(request('/api/push/subscriptions', 'POST', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/parking-validation',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    }), {} as PushContext);
    const identity = await response.json() as { subscriptionId: string; alertToken: string };
    const handler = createParkingPushAlertsHandler(dependencies);
    const invalid = await handler(request('/api/push/parking-alerts', 'POST', {
      parkingId: '42', parkingName: '甲停車場', threshold: 101,
    }, auth(identity)), context());
    expect(invalid.status).toBe(400);
    expect(JSON.stringify([...alerts.values.values()])).not.toContain(identity.alertToken);
  });
});
