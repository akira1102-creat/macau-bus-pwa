import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCatalogRepository } from '../../src/data/catalog-repository';
import { TransitCatalogSchema } from '../../shared/transit-contract';
import {
  createArrivalObservationFetcher,
  runArrivalAlertCheck,
  config as checkerConfig,
  type ArrivalAlertCheckDependencies,
} from '../../netlify/functions/check-arrival-alerts';
import { RealtimeCache } from '../../server/cache/realtime-cache';
import type { RealtimeRouteResponse } from '../../shared/transit-contract';
import type {
  JsonBlobStore,
  PushReservation,
  StoredAlert,
  StoredSubscription,
} from '../../netlify/functions/_shared/push-store';

const catalog = createCatalogRepository(TransitCatalogSchema.parse(JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/catalog/catalog.json', import.meta.url)), 'utf8'),
)));

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

const subscription: StoredSubscription = {
  id: 'subscription-1',
  endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
  keys: { p256dh: 'public-key', auth: 'auth-secret' },
  tokenHash: 'a'.repeat(64),
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z',
};

let subscriptions: MemoryBlobStore<StoredSubscription>;
let alerts: MemoryBlobStore<StoredAlert>;
let reservations: MemoryBlobStore<PushReservation>;
let now: Date;
let sent: Array<{ payload: string; subscriptionId: string }>;

function alert(
  id: string,
  targetStopId: string,
  targetStopIndex: number,
  threshold: number,
  expiresAt = '2026-08-22T04:00:00.000Z',
): StoredAlert {
  return {
    id,
    subscriptionId: subscription.id,
    routeId: '1',
    direction: 0,
    targetStopId,
    targetStopIndex,
    threshold,
    createdAt: '2026-08-22T00:00:00.000Z',
    expiresAt,
  };
}

function alertKey(id: string): string {
  return `${subscription.id}/${id}`;
}

function setup(
  fetchRoute: ArrivalAlertCheckDependencies['fetchRoute'] = vi.fn(async () => ([
    { plate: 'PLATE-001', stationCode: 'M1', speedKph: 9, status: null, passengerFlow: null, busType: null, facilities: null },
    { plate: 'PLATE-002', stationCode: 'M2', speedKph: 8, status: null, passengerFlow: null, busType: null, facilities: null },
  ])),
  sendNotification: ArrivalAlertCheckDependencies['sendNotification'] = vi.fn(async () => undefined),
): ArrivalAlertCheckDependencies {
  now = new Date('2026-08-22T00:00:00.000Z');
  subscriptions = new MemoryBlobStore<StoredSubscription>();
  alerts = new MemoryBlobStore<StoredAlert>();
  reservations = new MemoryBlobStore<PushReservation>();
  sent = [];
  void subscriptions.set(subscription.id, subscription);
  return {
    stores: { subscriptions, alerts, reservations },
    catalog,
    now: () => new Date(now),
    fetchRoute,
    sendNotification: async (value, payload) => {
      sent.push({ subscriptionId: value.id, payload });
      await sendNotification(value, payload);
    },
  };
}

describe('minute arrival alert checker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('declares the minute schedule for Netlify Scheduled Functions', () => {
    expect(checkerConfig).toMatchObject({ schedule: '* * * * *' });
  });

  it('groups route-direction fetches and sends the nearest qualifying bus once', async () => {
    const fetchRoute = vi.fn(async () => ([
      { plate: 'PLATE-001', stationCode: 'M1', speedKph: 9, status: null, passengerFlow: null, busType: null, facilities: null },
      { plate: 'PLATE-002', stationCode: 'M2', speedKph: 8, status: null, passengerFlow: null, busType: null, facilities: null },
    ]));
    const dependencies = setup(fetchRoute);
    await alerts.set(alertKey('alert-1'), alert('alert-1', 'M2', 1, 1));
    await alerts.set(alertKey('alert-2'), alert('alert-2', 'M3', 2, 2));

    const result = await runArrivalAlertCheck(dependencies);

    expect(fetchRoute).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(2);
    expect(JSON.parse(sent[0]?.payload ?? '{}')).toMatchObject({
      route: '1',
      direction: 0,
      stop: 'M2',
      plate: 'PLATE-002',
      remainingStops: 0,
      url: 'https://akira1102-creat.github.io/macau-bus-pwa/?tab=routes&route=1&direction=0',
    });
    expect(JSON.parse(sent[0]?.payload ?? '{}').body).toBe('路線 1 方向 0，站點 M2，車牌 PLATE-002，尚餘 0 站');
    expect(result.sent).toBe(2);
    expect(await alerts.get(alertKey('alert-1'))).toBeUndefined();
    expect(await alerts.get(alertKey('alert-2'))).toBeUndefined();
  });

  it('does not send before the configured threshold and retains the alert', async () => {
    const dependencies = setup(vi.fn(async () => ([
      { plate: 'PLATE-001', stationCode: 'M1', speedKph: 9, status: null, passengerFlow: null, busType: null, facilities: null },
    ])));
    await alerts.set(alertKey('alert-early'), alert('alert-early', 'M3', 2, 1));

    const result = await runArrivalAlertCheck(dependencies);

    expect(sent).toHaveLength(0);
    expect(result.sent).toBe(0);
    expect(await alerts.get(alertKey('alert-early'))).toBeDefined();
  });

  it('retains alerts when the upstream fetch or push provider fails transiently', async () => {
    const fetchRoute = vi.fn(async () => { throw new Error('temporary DSAT outage'); });
    const dependencies = setup(fetchRoute);
    await alerts.set(alertKey('alert-upstream'), alert('alert-upstream', 'M2', 1, 1));
    await runArrivalAlertCheck(dependencies);
    expect(await alerts.get(alertKey('alert-upstream'))).toBeDefined();

    const pushFailure = vi.fn()
      .mockRejectedValueOnce({ statusCode: 503 })
      .mockResolvedValueOnce(undefined);
    const second = setup(undefined, pushFailure);
    await alerts.set(alertKey('alert-push'), alert('alert-push', 'M2', 1, 1));
    await runArrivalAlertCheck(second);

    expect(await alerts.get(alertKey('alert-push'))).toMatchObject({ state: 'pending' });
    await runArrivalAlertCheck(second);
    expect(pushFailure).toHaveBeenCalledTimes(2);
    expect(await alerts.get(alertKey('alert-push'))).toBeUndefined();

    const ambiguousFailure = vi.fn()
      .mockRejectedValueOnce({ unexpected: true })
      .mockResolvedValueOnce(undefined);
    const ambiguous = setup(undefined, ambiguousFailure);
    await alerts.set(alertKey('alert-ambiguous'), alert('alert-ambiguous', 'M2', 1, 1));
    await runArrivalAlertCheck(ambiguous);
    expect(await alerts.get(alertKey('alert-ambiguous'))).toMatchObject({ state: 'pending' });
    await runArrivalAlertCheck(ambiguous);
    expect(ambiguousFailure).toHaveBeenCalledTimes(2);
    expect(await alerts.get(alertKey('alert-ambiguous'))).toBeUndefined();
  });

  it('retains a whole route group when an injected realtime response is stale', async () => {
    const dependencies = setup(vi.fn(async () => ({
      route: '1',
      direction: 0 as const,
      updatedAt: '2026-08-21T23:59:47.000Z',
      ageSeconds: 13,
      stale: true,
      source: 'DSAT observation' as const,
      buses: [
        { plate: 'STALE-001', stationCode: 'M2', speedKph: 8, status: null, passengerFlow: null, busType: null, facilities: null },
      ],
    })));
    await alerts.set(alertKey('alert-stale-route'), alert('alert-stale-route', 'M2', 1, 1));

    const result = await runArrivalAlertCheck(dependencies);

    expect(result.sent).toBe(0);
    expect(result.retained).toBe(1);
    expect(sent).toHaveLength(0);
    expect(await alerts.get(alertKey('alert-stale-route'))).toMatchObject({ id: 'alert-stale-route', routeId: '1' });
    expect(await alerts.get(alertKey('alert-stale-route'))).not.toHaveProperty('claimId');
  });

  it('preserves stale cache metadata when an upstream refresh fails', async () => {
    let clock = 0;
    const upstream = vi.fn()
      .mockResolvedValueOnce({
        applicationHeader: '000' as const,
        buses: [
          { plate: 'CACHED-001', stationCode: 'M2', speedKph: 8, status: null, passengerFlow: null, busType: null, facilities: null },
        ],
        raw: { header: '000', data: { routeInfo: [] } },
      })
      .mockRejectedValueOnce(new Error('temporary upstream failure'));
    const fetchRoute = createArrivalObservationFetcher({
      client: { fetchRoute: upstream },
      cache: new RealtimeCache<RealtimeRouteResponse>({ now: () => clock, freshTtlMs: 12_000 }),
    });

    const fresh = await fetchRoute('1', 0);
    clock = 13_000;
    const stale = await fetchRoute('1', 0);

    expect(fresh).toMatchObject({ stale: false, ageSeconds: 0 });
    expect(stale).toMatchObject({ stale: true, ageSeconds: 13, buses: [{ plate: 'CACHED-001' }] });
  });

  it('deletes expired alerts before fetching observations', async () => {
    const fetchRoute = vi.fn(async () => []);
    const dependencies = setup(fetchRoute);
    await alerts.set(alertKey('alert-expired'), alert(
      'alert-expired', 'M2', 1, 1, '2026-08-21T23:59:59.000Z',
    ));

    const result = await runArrivalAlertCheck(dependencies);

    expect(result.expired).toBe(1);
    expect(await alerts.get(alertKey('alert-expired'))).toBeUndefined();
    expect(fetchRoute).not.toHaveBeenCalled();
  });

  it.each([404, 410])('removes a dead subscription and all its alerts on push HTTP %s', async (statusCode) => {
    const pushFailure = vi.fn(async () => { throw { statusCode }; });
    const dependencies = setup(undefined, pushFailure);
    await reservations.set(subscription.id, {
      id: subscription.id,
      subscriptionId: subscription.id,
      owner: 'dead-owner',
      expiresAt: '2026-08-21T23:59:59.000Z',
    });
    await alerts.set(alertKey('alert-dead-1'), alert('alert-dead-1', 'M2', 1, 1));
    await alerts.set(alertKey('alert-dead-2'), alert('alert-dead-2', 'M3', 2, 1));

    const result = await runArrivalAlertCheck(dependencies);

    expect(result.deadSubscriptions).toBe(1);
    expect(await subscriptions.get(subscription.id)).toBeUndefined();
    expect(await reservations.get(subscription.id)).toBeUndefined();
    expect(await alerts.get(alertKey('alert-dead-1'))).toBeUndefined();
    expect(await alerts.get(alertKey('alert-dead-2'))).toBeUndefined();
  });

  it('uses a validated PUBLIC_APP_URL base path in the notification deep link', async () => {
    vi.stubGlobal('Netlify', {
      env: { get: (name: string) => name === 'PUBLIC_APP_URL' ? 'https://notify.example/macau-bus-pwa/' : undefined },
    });
    const dependencies = setup();
    await alerts.set(alertKey('alert-base-url'), alert('alert-base-url', 'M2', 1, 1));

    await runArrivalAlertCheck(dependencies);

    const payload = JSON.parse(sent[0]?.payload ?? '{}') as { url?: string };
    expect(payload.url).toBe('https://notify.example/macau-bus-pwa/?tab=routes&route=1&direction=0');
  });

  it('marks a delivered reminder before cleanup so a delete failure cannot resend it', async () => {
    const dependencies = setup();
    await alerts.set(alertKey('alert-delivery'), alert('alert-delivery', 'M2', 1, 1));
    const deleteAlert = alerts.delete.bind(alerts);
    let failDelete = true;
    vi.spyOn(alerts, 'delete').mockImplementation(async (key) => {
      if (key === alertKey('alert-delivery') && failDelete) {
        failDelete = false;
        throw new Error('temporary blob delete failure');
      }
      await deleteAlert(key);
    });

    await runArrivalAlertCheck(dependencies);
    expect(sent).toHaveLength(1);
    expect(await alerts.get(alertKey('alert-delivery'))).toMatchObject({ state: 'delivered' });

    await runArrivalAlertCheck(dependencies);
    expect(sent).toHaveLength(1);
    expect(await alerts.get(alertKey('alert-delivery'))).toMatchObject({ state: 'delivered' });

    now = new Date('2026-08-22T04:00:00.001Z');
    await runArrivalAlertCheck(dependencies);
    expect(await alerts.get(alertKey('alert-delivery'))).toBeUndefined();
  });

  it('claims a reminder durably so overlapping checkers send it only once', async () => {
    let enteredResolve!: () => void;
    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
    let releaseResolve!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });
    const sender = vi.fn(async () => {
      enteredResolve();
      await release;
    });
    const dependencies = setup(undefined, sender);
    await alerts.set(alertKey('alert-overlap'), alert('alert-overlap', 'M2', 1, 1));

    const first = runArrivalAlertCheck(dependencies);
    await entered;
    const second = runArrivalAlertCheck(dependencies);
    releaseResolve();
    await Promise.all([first, second]);

    expect(sender).toHaveBeenCalledTimes(1);
    expect(await alerts.get(alertKey('alert-overlap'))).toBeUndefined();
  });

  it('releases the claim so a delivered CAS failure can retry on the next run', async () => {
    const dependencies = setup();
    await alerts.set(alertKey('alert-accepted-cas-failure'), alert('alert-accepted-cas-failure', 'M2', 1, 1));
    const setIfMatch = alerts.setIfMatch.bind(alerts);
    let failDelivered = true;
    vi.spyOn(alerts, 'setIfMatch').mockImplementation(async (key, value, etag) => {
      if (value.state === 'delivered' && failDelivered) {
        failDelivered = false;
        return false;
      }
      return setIfMatch(key, value, etag);
    });

    await runArrivalAlertCheck(dependencies);
    expect(sent).toHaveLength(1);
    expect(await alerts.get(alertKey('alert-accepted-cas-failure'))).toMatchObject({ state: 'pending' });

    await runArrivalAlertCheck(dependencies);
    expect(sent).toHaveLength(2);
    expect(await alerts.get(alertKey('alert-accepted-cas-failure'))).toBeUndefined();
  });

  it('CAS-reclaims an expired claimed reminder and sends it once', async () => {
    const dependencies = setup();
    await alerts.set(alertKey('alert-stale-claim'), {
      ...alert('alert-stale-claim', 'M2', 1, 1),
      state: 'claimed',
      claimId: 'old-claim',
      claimExpiresAt: '2026-08-21T23:59:59.000Z',
    });

    await runArrivalAlertCheck(dependencies);

    expect(sent).toHaveLength(1);
    expect(await alerts.get(alertKey('alert-stale-claim'))).toBeUndefined();
  });
});
