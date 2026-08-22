import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPushPublicKeyHandler,
} from '../../netlify/functions/push-public-key';
import {
  createPushSubscriptionsHandler,
} from '../../netlify/functions/push-subscriptions';
import {
  createPushAlertsHandler,
} from '../../netlify/functions/push-alerts';
import { createCatalogRepository } from '../../src/data/catalog-repository';
import { TransitCatalogSchema } from '../../shared/transit-contract';
import { RealtimeRateLimiter } from '../../server/routes/realtime';
import {
  GLOBAL_SUBSCRIPTION_ADMISSION_KEY,
  GLOBAL_SUBSCRIPTION_ADMISSION_TTL_MS,
} from '../../netlify/functions/_shared/push-store';
import type {
  JsonBlobStore,
  PushReservation,
  PushApiDependencies,
  StoredAlert,
  StoredSubscription,
} from '../../netlify/functions/_shared/push-store';

const allowedOrigin = 'https://akira1102-creat.github.io';
const catalog = createCatalogRepository(TransitCatalogSchema.parse(JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/catalog/catalog.json', import.meta.url)), 'utf8'),
)));

type PushContext = Parameters<ReturnType<typeof createPushPublicKeyHandler>>[1];

class MemoryBlobStore<T extends { id: string }> implements JsonBlobStore<T> {
  readonly values = new Map<string, T>();
  private readonly versions = new Map<string, number>();

  async get(key: string): Promise<T | undefined> {
    return this.values.get(key);
  }

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

let subscriptions: MemoryBlobStore<StoredSubscription>;
let alerts: MemoryBlobStore<StoredAlert>;
let reservations: MemoryBlobStore<PushReservation>;
let dependencies: PushApiDependencies;
let now: Date;

function setup(): void {
  now = new Date('2026-08-22T00:00:00.000Z');
  subscriptions = new MemoryBlobStore<StoredSubscription>();
  alerts = new MemoryBlobStore<StoredAlert>();
  reservations = new MemoryBlobStore<PushReservation>();
  dependencies = {
    stores: { subscriptions, alerts, reservations },
    catalog,
    now: () => new Date(now),
    publicKey: 'PUBLIC-VAPID-KEY',
  };
}

function request(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
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

function context(alertId?: string, ip?: string): PushContext {
  return {
    params: alertId === undefined ? {} : { alertId },
    ...(ip === undefined ? {} : { ip }),
  } as unknown as PushContext;
}

function auth(identity: { subscriptionId: string; alertToken: string }): Record<string, string> {
  return {
    Authorization: `Bearer ${identity.alertToken}`,
    'X-Subscription-Id': identity.subscriptionId,
  };
}

beforeEach(setup);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GET /api/push/public-key', () => {
  it('returns the configured public key with exact CORS and no-store headers', async () => {
    const handler = createPushPublicKeyHandler(dependencies);
    const response = await handler(request('/api/push/public-key'), {} as PushContext);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
    expect(await response.json()).toEqual({ publicKey: 'PUBLIC-VAPID-KEY' });
  });

  it('answers OPTIONS and rejects other origins or methods', async () => {
    const handler = createPushPublicKeyHandler(dependencies);
    const options = await handler(request('/api/push/public-key', 'OPTIONS'), {} as PushContext);
    const cors = await handler(new Request('https://function.example/api/push/public-key', {
      headers: { Origin: 'https://attacker.example' },
    }), {} as PushContext);
    const method = await handler(request('/api/push/public-key', 'POST'), {} as PushContext);

    expect(options.status).toBe(204);
    expect(options.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
    expect(cors.status).toBe(403);
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('GET, OPTIONS');
  });
});

describe('push subscription and alert CRUD', () => {
  it('creates a random identity and stores only a SHA-256 capability hash', async () => {
    const handler = createPushSubscriptionsHandler(dependencies);
    const response = await handler(request('/api/push/subscriptions', 'POST', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    }), {} as PushContext);
    const identity = await response.json() as { subscriptionId: string; alertToken: string };
    const stored = await subscriptions.get(identity.subscriptionId);

    expect(response.status).toBe(201);
    expect(identity.subscriptionId).toMatch(/^[a-f0-9]{32}$/);
    expect(identity.alertToken).toHaveLength(43);
    expect(stored).toMatchObject({
      id: identity.subscriptionId,
      endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    });
    expect(stored?.tokenHash).toBe(createHash('sha256').update(identity.alertToken).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(identity.alertToken);
  });

  it('requires bearer authorization, validates alert input, lists active alerts, and deletes one', async () => {
    const subscriptionsHandler = createPushSubscriptionsHandler(dependencies);
    const alertsHandler = createPushAlertsHandler(dependencies);
    const subscriptionResponse = await subscriptionsHandler(request('/api/push/subscriptions', 'POST', {
      endpoint: 'https://web.push.apple.com/3/device/subscription-2',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    }), {} as PushContext);
    const identity = await subscriptionResponse.json() as { subscriptionId: string; alertToken: string };

    const unauthorized = await alertsHandler(request('/api/push/alerts'), context());
    const invalid = await alertsHandler(request('/api/push/alerts', 'POST', {
      routeId: '1', direction: 0, targetStopId: 'M1', targetStopIndex: 0, threshold: 11,
    }, auth(identity)), context());
    const created = await alertsHandler(request('/api/push/alerts', 'POST', {
      routeId: '1', direction: 0, targetStopId: 'M2', targetStopIndex: 1, threshold: 3,
    }, auth(identity)), context());
    const summary = await created.json() as { id: string; expiresAt: string; threshold: number };
    const listed = await alertsHandler(request('/api/push/alerts', 'GET', undefined, auth(identity)), context());
    const deleted = await alertsHandler(
      request(`/api/push/alerts/${summary.id}`, 'DELETE', undefined, auth(identity)),
      context(summary.id),
    );

    expect(unauthorized.status).toBe(401);
    expect(invalid.status).toBe(400);
    expect(created.status).toBe(201);
    expect(summary).toMatchObject({ threshold: 3 });
    expect(summary.expiresAt).toBe('2026-08-22T04:00:00.000Z');
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ alerts: [summary] });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
    expect(await alerts.get(`${identity.subscriptionId}/${summary.id}`)).toBeUndefined();
  });

  it('enforces five active alerts, removes expired records, and rejects mismatched route stops', async () => {
    const subscriptionsHandler = createPushSubscriptionsHandler(dependencies);
    const alertsHandler = createPushAlertsHandler(dependencies);
    const subscriptionResponse = await subscriptionsHandler(request('/api/push/subscriptions', 'POST', {
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/subscription-3',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    }), {} as PushContext);
    const identity = await subscriptionResponse.json() as { subscriptionId: string; alertToken: string };
    const authHeaders = auth(identity);

    for (let index = 0; index < 5; index += 1) {
      const response = await alertsHandler(request('/api/push/alerts', 'POST', {
        routeId: '1', direction: 0, targetStopId: 'M2', targetStopIndex: 1, threshold: index + 1,
      }, authHeaders), context());
      expect(response.status).toBe(201);
    }
    const limit = await alertsHandler(request('/api/push/alerts', 'POST', {
      routeId: '1', direction: 0, targetStopId: 'M2', targetStopIndex: 1, threshold: 1,
    }, authHeaders), context());
    const invalidStop = await alertsHandler(request('/api/push/alerts', 'POST', {
      routeId: '1', direction: 0, targetStopId: 'M1', targetStopIndex: 1, threshold: 1,
    }, authHeaders), context());

    expect(limit.status).toBe(409);
    expect(await limit.json()).toEqual({ error: 'active-limit' });
    expect(invalidStop.status).toBe(400);

    const first = (await alerts.list())[0];
    const firstAlert = first === undefined ? undefined : await alerts.get(first);
    if (first !== undefined && firstAlert) {
      firstAlert.expiresAt = '2026-08-21T23:59:59.000Z';
      await alerts.set(first, firstAlert);
    }
    const listed = await alertsHandler(request('/api/push/alerts', 'GET', undefined, authHeaders), context());
    const listedBody = await listed.json() as { alerts: Array<{ id: string }> };

    expect(listedBody.alerts).toHaveLength(4);
    expect(firstAlert === undefined ? undefined : await alerts.get(`${identity.subscriptionId}/${firstAlert.id}`)).toBeUndefined();
  });

  it('rejects malformed subscription JSON and preserves the production method allowlist', async () => {
    const handler = createPushSubscriptionsHandler(dependencies);
    const malformed = await handler(request('/api/push/subscriptions', 'POST', '{'), {} as PushContext);
    const method = await handler(request('/api/push/subscriptions', 'GET'), {} as PushContext);

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'invalid-json' });
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('POST, OPTIONS');
  });

  it('requires the trusted production Origin for mutation and rejects non-provider endpoints', async () => {
    const handler = createPushSubscriptionsHandler(dependencies);
    const noOrigin = new Request('https://function.example/api/push/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-origin',
        keys: { p256dh: 'public-key', auth: 'auth-secret' },
      }),
    });
    const untrusted = await handler(new Request(noOrigin, { headers: { ...Object.fromEntries(noOrigin.headers), Origin: 'https://attacker.example' } }), {} as PushContext);
    const missing = await handler(noOrigin, {} as PushContext);
    const privateHost = await handler(request('/api/push/subscriptions', 'POST', {
      endpoint: 'https://push.example.test/subscription/private',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    }), {} as PushContext);
    const customPort = await handler(request('/api/push/subscriptions', 'POST', {
      endpoint: 'https://fcm.googleapis.com:8443/fcm/send/custom-port',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    }), {} as PushContext);
    const userInfo = await handler(request('/api/push/subscriptions', 'POST', {
      endpoint: 'https://attacker:secret@fcm.googleapis.com/fcm/send/user-info',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    }), {} as PushContext);

    expect(untrusted.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(privateHost.status).toBe(400);
    expect(customPort.status).toBe(400);
    expect(userInfo.status).toBe(400);
  });

  it('also requires the trusted Origin for authenticated alert mutations', async () => {
    const subscriptionsHandler = createPushSubscriptionsHandler(dependencies);
    const alertsHandler = createPushAlertsHandler(dependencies);
    const subscriptionResponse = await subscriptionsHandler(request('/api/push/subscriptions', 'POST', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/origin-alert',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    }), {} as PushContext);
    const identity = await subscriptionResponse.json() as { subscriptionId: string; alertToken: string };
    const noOrigin = new Request('https://function.example/api/push/alerts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...auth(identity),
      },
      body: JSON.stringify({
        routeId: '1', direction: 0, targetStopId: 'M2', targetStopIndex: 1, threshold: 1,
      }),
    });
    const response = await alertsHandler(noOrigin, context());

    expect(response.status).toBe(403);
  });

  it('also requires the trusted Origin for authenticated alert list reads', async () => {
    const subscriptionsHandler = createPushSubscriptionsHandler(dependencies);
    const alertsHandler = createPushAlertsHandler(dependencies);
    const subscriptionResponse = await subscriptionsHandler(request('/api/push/subscriptions', 'POST', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/origin-alert-read',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    }), {} as PushContext);
    const identity = await subscriptionResponse.json() as { subscriptionId: string; alertToken: string };
    const noOrigin = new Request('https://function.example/api/push/alerts', {
      method: 'GET',
      headers: auth(identity),
    });

    const response = await alertsHandler(noOrigin, context());

    expect(response.status).toBe(403);
  });

  it('uses subscription-prefixed alert keys for list and direct-key delete', async () => {
    const subscriptionsHandler = createPushSubscriptionsHandler(dependencies);
    const alertsHandler = createPushAlertsHandler(dependencies);
    const subscriptionResponse = await subscriptionsHandler(request('/api/push/subscriptions', 'POST', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/prefixed-alert',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    }), {} as PushContext);
    const identity = await subscriptionResponse.json() as { subscriptionId: string; alertToken: string };
    const headers = auth(identity);
    const created = await alertsHandler(request('/api/push/alerts', 'POST', {
      routeId: '1', direction: 0, targetStopId: 'M2', targetStopIndex: 1, threshold: 1,
    }, headers), context());
    const summary = await created.json() as { id: string };
    const prefixedKey = `${identity.subscriptionId}/${summary.id}`;

    expect(await alerts.get(prefixedKey)).toBeDefined();
    expect(await alerts.get(summary.id)).toBeUndefined();

    const list = vi.spyOn(alerts, 'list');
    const listed = await alertsHandler(request('/api/push/alerts', 'GET', undefined, headers), context());
    expect(listed.status).toBe(200);
    expect(list).toHaveBeenCalledWith(`${identity.subscriptionId}/`);

    list.mockClear();
    const deleted = await alertsHandler(
      request(`/api/push/alerts/${summary.id}`, 'DELETE', undefined, headers),
      context(summary.id),
    );
    expect(deleted.status).toBe(200);
    expect(list).not.toHaveBeenCalled();
    expect(await alerts.get(prefixedKey)).toBeUndefined();
  });

  it('applies a bounded mutation rate limit per caller', async () => {
    dependencies.rateLimiter = new RealtimeRateLimiter({
      now: () => now.getTime(),
      windowMs: 60_000,
      maxRequests: 1,
      maxTrackedKeys: 2,
    });
    const handler = createPushSubscriptionsHandler(dependencies);
    const body = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/rate-limit',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    };

    const first = await handler(request('/api/push/subscriptions', 'POST', body), {} as PushContext);
    const second = await handler(request('/api/push/subscriptions', 'POST', body), {} as PushContext);

    expect(first.status).toBe(201);
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: 'rate-limit-exceeded' });
  });

  it('applies a bounded rate limit to authenticated alert list reads', async () => {
    const subscriptionsHandler = createPushSubscriptionsHandler(dependencies);
    const alertsHandler = createPushAlertsHandler(dependencies);
    const subscriptionResponse = await subscriptionsHandler(request('/api/push/subscriptions', 'POST', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/read-rate-limit',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    }), context(undefined, '198.51.100.10'));
    const identity = await subscriptionResponse.json() as { subscriptionId: string; alertToken: string };
    dependencies.rateLimiter = new RealtimeRateLimiter({
      now: () => now.getTime(),
      windowMs: 60_000,
      maxRequests: 1,
      maxTrackedKeys: 2,
    });

    const first = await alertsHandler(request('/api/push/alerts', 'GET', undefined, auth(identity)), context(undefined, '198.51.100.10'));
    const second = await alertsHandler(request('/api/push/alerts', 'GET', undefined, auth(identity)), context(undefined, '198.51.100.10'));

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: 'rate-limit-exceeded' });
  });

  it('bounds stale-subscription cleanup before enforcing the global store cap', async () => {
    const stale = (id: string, updatedAt: string): StoredSubscription => ({
      id,
      endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
      tokenHash: 'a'.repeat(64),
      createdAt: updatedAt,
      updatedAt,
    });
    await subscriptions.set('stale-1', stale('stale-1', '2026-08-20T00:00:00.000Z'));
    await subscriptions.set('stale-2', stale('stale-2', '2026-08-20T00:00:00.000Z'));
    await subscriptions.set('fresh', stale('fresh', '2026-08-22T00:00:00.000Z'));
    dependencies.staleSubscriptionMs = 60 * 60 * 1_000;
    dependencies.maxStaleCleanup = 1;
    dependencies.globalSubscriptionLimit = 2;

    const response = await createPushSubscriptionsHandler(dependencies)(request(
      '/api/push/subscriptions',
      'POST',
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/new-subscription',
        keys: { p256dh: 'public-key', auth: 'auth-secret' },
      },
    ), {} as PushContext);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'subscription-limit' });
    expect(await subscriptions.get('stale-1')).toBeUndefined();
    expect(await subscriptions.get('stale-2')).toBeDefined();
  });

  it('recomputes the global cap after stale cleanup releases a subscription', async () => {
    const stale: StoredSubscription = {
      id: 'stale-only',
      endpoint: 'https://fcm.googleapis.com/fcm/send/stale-only',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
      tokenHash: 'a'.repeat(64),
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
    };
    await subscriptions.set(stale.id, stale);
    await reservations.set(stale.id, {
      id: stale.id,
      subscriptionId: stale.id,
      owner: 'stale-owner',
      expiresAt: '2026-08-20T00:00:00.000Z',
    });
    dependencies.staleSubscriptionMs = 60 * 60 * 1_000;
    dependencies.globalSubscriptionLimit = 1;

    const response = await createPushSubscriptionsHandler(dependencies)(request(
      '/api/push/subscriptions',
      'POST',
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/recomputed-cap',
        keys: { p256dh: 'public-key', auth: 'auth-secret' },
      },
    ), context(undefined, '203.0.113.12'));

    expect(response.status).toBe(201);
    expect(await subscriptions.get(stale.id)).toBeUndefined();
    expect(await reservations.get(stale.id)).toBeUndefined();
    expect(await subscriptions.list()).toHaveLength(1);
  });

  it('atomically admits concurrent subscriptions across different caller IPs', async () => {
    dependencies.globalSubscriptionLimit = 1;
    const handler = createPushSubscriptionsHandler(dependencies);
    const body = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/global-cap',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    };
    const responses = await Promise.all([
      handler(request('/api/push/subscriptions', 'POST', body), context(undefined, '198.51.100.21')),
      handler(request('/api/push/subscriptions', 'POST', body), context(undefined, '198.51.100.22')),
    ]);

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status !== 201)).toHaveLength(1);
    expect((await subscriptions.list())).toHaveLength(1);
  });

  it('reclaims an expired global admission lease before checking the cap', async () => {
    dependencies.globalSubscriptionLimit = 1;
    await reservations.set(GLOBAL_SUBSCRIPTION_ADMISSION_KEY, {
      id: GLOBAL_SUBSCRIPTION_ADMISSION_KEY,
      subscriptionId: GLOBAL_SUBSCRIPTION_ADMISSION_KEY,
      owner: 'expired-owner',
      expiresAt: '2026-08-21T23:59:59.000Z',
    });

    const response = await createPushSubscriptionsHandler(dependencies)(request(
      '/api/push/subscriptions',
      'POST',
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/reclaim-global-lease',
        keys: { p256dh: 'public-key', auth: 'auth-secret' },
      },
    ), context(undefined, '203.0.113.13'));

    expect(response.status).toBe(201);
  });

  it('renews the global admission lease before writing after slow work crosses the old 15-second TTL', async () => {
    expect(GLOBAL_SUBSCRIPTION_ADMISSION_TTL_MS).toBeGreaterThanOrEqual(5 * 60 * 1_000);
    const handler = createPushSubscriptionsHandler(dependencies);
    const originalList = subscriptions.list.bind(subscriptions);
    let advanced = false;
    vi.spyOn(subscriptions, 'list').mockImplementation(async (prefix) => {
      const keys = await originalList(prefix);
      if (!advanced) {
        advanced = true;
        now = new Date(now.getTime() + 16_000);
      }
      return keys;
    });
    const originalSetIfMatch = reservations.setIfMatch.bind(reservations);
    const renewals: string[] = [];
    vi.spyOn(reservations, 'setIfMatch').mockImplementation(async (key, value, etag) => {
      const result = await originalSetIfMatch(key, value, etag);
      if (key === GLOBAL_SUBSCRIPTION_ADMISSION_KEY && Date.parse(value.expiresAt) > now.getTime()) {
        renewals.push(value.expiresAt);
      }
      return result;
    });

    const response = await handler(request('/api/push/subscriptions', 'POST', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/slow-admission',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    }), context(undefined, '203.0.113.21'));

    expect(response.status).toBe(201);
    expect(renewals).toHaveLength(1);
    expect(Date.parse(renewals[0] ?? '')).toBeGreaterThan(now.getTime() + 4 * 60 * 1_000);
  });

  it('rejects without writing when the global admission owner changes before revalidation', async () => {
    const handler = createPushSubscriptionsHandler(dependencies);
    const originalList = subscriptions.list.bind(subscriptions);
    let advanced = false;
    vi.spyOn(subscriptions, 'list').mockImplementation(async (prefix) => {
      const keys = await originalList(prefix);
      if (!advanced) {
        advanced = true;
        now = new Date(now.getTime() + 16_000);
      }
      return keys;
    });
    const originalSetIfMatch = reservations.setIfMatch.bind(reservations);
    let ownershipChanged = false;
    vi.spyOn(reservations, 'setIfMatch').mockImplementation(async (key, value, etag) => {
      if (!ownershipChanged && key === GLOBAL_SUBSCRIPTION_ADMISSION_KEY && Date.parse(value.expiresAt) > now.getTime()) {
        ownershipChanged = true;
        await reservations.set(key, { ...value, owner: 'replacement-owner' });
      }
      return originalSetIfMatch(key, value, etag);
    });

    const response = await handler(request('/api/push/subscriptions', 'POST', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/lost-admission',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    }), context(undefined, '203.0.113.22'));

    expect(response.status).toBe(409);
    expect(await subscriptions.list()).toHaveLength(0);
  });

  it('does not exceed five active alerts when six creates race concurrently', async () => {
    const subscriptionsHandler = createPushSubscriptionsHandler(dependencies);
    const alertsHandler = createPushAlertsHandler(dependencies);
    const subscriptionResponse = await subscriptionsHandler(request('/api/push/subscriptions', 'POST', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/concurrent',
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    }), {} as PushContext);
    const identity = await subscriptionResponse.json() as { subscriptionId: string; alertToken: string };
    const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => alertsHandler(
      request('/api/push/alerts', 'POST', {
        routeId: '1', direction: 0, targetStopId: 'M2', targetStopIndex: 1, threshold: (index % 10) + 1,
      }, auth(identity)), context(),
    )));
    const listed = await alertsHandler(request('/api/push/alerts', 'GET', undefined, auth(identity)), context());
    const body = await listed.json() as { alerts: unknown[] };

    const successfulCreates = responses.filter((response) => response.status === 201);
    expect(successfulCreates.length).toBeGreaterThan(0);
    expect(successfulCreates.length).toBeLessThanOrEqual(5);
    expect(body.alerts.length).toBeLessThanOrEqual(5);
  });
});
