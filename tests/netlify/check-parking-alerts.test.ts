import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config as checkerConfig, runParkingAlertCheck, type ParkingAlertCheckDependencies } from '../../netlify/functions/check-parking-alerts';
import type { ParkingSnapshot } from '../../shared/parking-contract';
import type { DeadSubscriptionCleanup, JsonBlobStore, PushReservation, StoredParkingAlert, StoredSubscription } from '../../netlify/functions/_shared/push-store';

class MemoryBlobStore<T extends { id: string }> implements JsonBlobStore<T> {
  readonly values = new Map<string, T>();
  failNextDelete: Error | undefined;
  failNextSet: Error | undefined;
  private readonly versions = new Map<string, number>();
  async get(key: string): Promise<T | undefined> { return this.values.get(key); }
  async getWithMetadata(key: string): Promise<{ value: T; etag?: string } | undefined> {
    const value = this.values.get(key);
    return value === undefined ? undefined : { value, etag: String(this.versions.get(key) ?? 0) };
  }
  async set(key: string, value: T): Promise<void> {
    if (this.failNextSet) {
      const failure = this.failNextSet;
      this.failNextSet = undefined;
      throw failure;
    }
    this.values.set(key, value);
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
  }
  async setIfNew(key: string, value: T): Promise<boolean> { if (this.values.has(key)) return false; await this.set(key, value); return true; }
  async setIfMatch(key: string, value: T, etag: string): Promise<boolean> { if (!this.values.has(key) || String(this.versions.get(key) ?? 0) !== etag) return false; await this.set(key, value); return true; }
  async delete(key: string): Promise<void> {
    if (this.failNextDelete) {
      const failure = this.failNextDelete;
      this.failNextDelete = undefined;
      throw failure;
    }
    this.values.delete(key);
    this.versions.delete(key);
  }
  async list(prefix?: string): Promise<string[]> { return [...this.values.keys()].filter((key) => prefix === undefined || key.startsWith(prefix)); }
}

const subscription: StoredSubscription = {
  id: 'subscription-parking',
  endpoint: 'https://fcm.googleapis.com/fcm/send/parking-check',
  keys: { p256dh: 'public-key', auth: 'auth-secret' },
  tokenHash: 'a'.repeat(64),
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z',
};

let subscriptions: MemoryBlobStore<StoredSubscription>;
let alerts: MemoryBlobStore<StoredParkingAlert>;
let reservations: MemoryBlobStore<PushReservation>;
let parkingReservations: MemoryBlobStore<PushReservation>;
let deadCleanup: MemoryBlobStore<DeadSubscriptionCleanup>;
let now: Date;
let sent: Array<{ payload: string; subscriptionId: string }>;

function facility(id: string, car: number | null, suspended = false) {
  return {
    id, name: `停車場 ${id}`, location: '澳門', entrance: null, latitude: null, longitude: null,
    spaces: { car, motorcycle: null, electricCar: null, electricMotorcycle: null, accessible: null },
    updatedAt: '2026-08-22T00:00:00.000Z', suspended,
  };
}

function snapshot(facilities: ReturnType<typeof facility>[], stale = false): ParkingSnapshot {
  return { updatedAt: '2026-08-22T00:00:00.000Z', stale, facilities };
}

function alert(id: string, parkingId: string, threshold: number, expiresAt = '2026-08-22T12:00:00.000Z'): StoredParkingAlert {
  return {
    id, subscriptionId: subscription.id, parkingId, parkingName: `停車場 ${parkingId}`, threshold,
    createdAt: '2026-08-22T00:00:00.000Z', expiresAt, state: 'pending',
  };
}

function key(id: string): string { return `${subscription.id}/${id}`; }

function setup(fetchParking: ParkingAlertCheckDependencies['fetchParking'] = vi.fn(async () => snapshot([])), sendNotification: ParkingAlertCheckDependencies['sendNotification'] = vi.fn(async () => undefined)): ParkingAlertCheckDependencies {
  now = new Date('2026-08-22T00:00:00.000Z');
  subscriptions = new MemoryBlobStore<StoredSubscription>();
  alerts = new MemoryBlobStore<StoredParkingAlert>();
  reservations = new MemoryBlobStore<PushReservation>();
  parkingReservations = new MemoryBlobStore<PushReservation>();
  deadCleanup = new MemoryBlobStore<DeadSubscriptionCleanup>();
  sent = [];
  void subscriptions.set(subscription.id, subscription);
  return {
    stores: { subscriptions, alerts: new MemoryBlobStore(), reservations, parkingAlerts: alerts, parkingReservations, deadSubscriptionCleanup: deadCleanup },
    now: () => new Date(now),
    fetchParking,
    sendNotification: async (value, payload) => { sent.push({ subscriptionId: value.id, payload }); await sendNotification(value, payload); },
    publicOrigin: 'https://akira1102-creat.github.io/macau-bus-pwa/',
  };
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('minute parking alert checker', () => {
  it('declares a minute schedule and fetches one parking snapshot for all alerts', async () => {
    const fetchParking = vi.fn(async () => snapshot([facility('42', 10), facility('43', 4)]));
    const dependencies = setup(fetchParking);
    await alerts.set(key('one'), alert('one', '42', 10));
    await alerts.set(key('two'), alert('two', '43', 5));

    const result = await runParkingAlertCheck(dependencies);
    expect(checkerConfig).toMatchObject({ schedule: '* * * * *' });
    expect(fetchParking).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(2);
    expect(await alerts.get(key('one'))).toBeUndefined();
    expect(JSON.parse(sent[0]?.payload ?? '{}')).toMatchObject({ parkingId: '42', threshold: 10, freeSpaces: 10, url: expect.stringContaining('mode=parking') });
  });

  it('does not trigger above threshold, null, paused, or missing values', async () => {
    const dependencies = setup(vi.fn(async () => snapshot([
      facility('above', 11), facility('null', null), facility('paused', 1, true),
    ])));
    await alerts.set(key('above'), alert('above', 'above', 10));
    await alerts.set(key('null'), alert('null', 'null', 10));
    await alerts.set(key('paused'), alert('paused', 'paused', 10));
    await alerts.set(key('missing'), alert('missing', 'missing', 10));

    const result = await runParkingAlertCheck(dependencies);
    expect(result.sent).toBe(0);
    expect(result.retained).toBe(4);
    expect(sent).toHaveLength(0);
  });

  it('retains transient upstream/push failures, removes expired records, and deletes dead subscriptions', async () => {
    const fetchParking = vi.fn(async () => snapshot([facility('42', 1)]));
    const sender = vi.fn().mockRejectedValueOnce({ statusCode: 503 }).mockResolvedValueOnce(undefined);
    const dependencies = setup(fetchParking, sender);
    await alerts.set(key('transient'), alert('transient', '42', 2));
    await runParkingAlertCheck(dependencies);
    expect(await alerts.get(key('transient'))).toMatchObject({ state: 'pending' });
    await runParkingAlertCheck(dependencies);
    expect(await alerts.get(key('transient'))).toBeUndefined();
    now = new Date('2026-08-22T12:00:01.000Z');
    await alerts.set(key('expired'), alert('expired', '42', 2, '2026-08-22T12:00:00.000Z'));
    const expiredResult = await runParkingAlertCheck(dependencies);
    expect(expiredResult.expired).toBe(1);
  });

  it('releases a generic push failure so the next checker run can retry', async () => {
    const sender = vi.fn()
      .mockRejectedValueOnce({ unexpected: true })
      .mockResolvedValueOnce(undefined);
    const dependencies = setup(vi.fn(async () => snapshot([facility('42', 1)])), sender);
    await alerts.set(key('generic-retry'), alert('generic-retry', '42', 2));

    await runParkingAlertCheck(dependencies);
    expect(await alerts.get(key('generic-retry'))).toMatchObject({ state: 'pending' });

    await runParkingAlertCheck(dependencies);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(await alerts.get(key('generic-retry'))).toBeUndefined();
  });

  it('treats a stale parking snapshot as transient without claiming or sending', async () => {
    const sender = vi.fn(async () => undefined);
    const dependencies = setup(vi.fn(async () => snapshot([facility('42', 1)], true)), sender);
    await alerts.set(key('stale-snapshot'), alert('stale-snapshot', '42', 2));

    const result = await runParkingAlertCheck(dependencies);

    expect(result.retained).toBe(1);
    expect(result.sent).toBe(0);
    expect(sender).not.toHaveBeenCalled();
    expect(await alerts.get(key('stale-snapshot'))).toMatchObject({ state: 'pending' });
  });

  it('CAS-reclaims an expired claimed parking alert and sends it once', async () => {
    const dependencies = setup(vi.fn(async () => snapshot([facility('42', 1)])));
    await alerts.set(key('expired-claim'), {
      ...alert('expired-claim', '42', 2),
      state: 'claimed',
      claimId: 'expired-claim-id',
      claimExpiresAt: '2026-08-21T23:59:59.000Z',
    });

    await runParkingAlertCheck(dependencies);

    expect(sent).toHaveLength(1);
    expect(await alerts.get(key('expired-claim'))).toBeUndefined();
  });

  it('releases the claim so a delivered CAS failure can retry on the next run', async () => {
    const dependencies = setup(vi.fn(async () => snapshot([facility('42', 1)])));
    await alerts.set(key('delivered-cas-retry'), alert('delivered-cas-retry', '42', 2));
    const setIfMatch = alerts.setIfMatch.bind(alerts);
    let failDelivered = true;
    vi.spyOn(alerts, 'setIfMatch').mockImplementation(async (storageKey, value, etag) => {
      if (value.state === 'delivered' && failDelivered) {
        failDelivered = false;
        return false;
      }
      return setIfMatch(storageKey, value, etag);
    });

    await runParkingAlertCheck(dependencies);
    expect(await alerts.get(key('delivered-cas-retry'))).toMatchObject({ state: 'pending' });

    await runParkingAlertCheck(dependencies);
    expect(sent).toHaveLength(2);
    expect(await alerts.get(key('delivered-cas-retry'))).toBeUndefined();
  });

  it.each([404, 410])('removes the subscription and its alerts on provider %s', async (statusCode) => {
    const sender = vi.fn(async () => { throw { statusCode }; });
    const dependencies = setup(vi.fn(async () => snapshot([facility('42', 1)])), sender);
    await alerts.set(key('dead'), alert('dead', '42', 2));
    const result = await runParkingAlertCheck(dependencies);
    expect(result.deadSubscriptions).toBe(1);
    expect(await subscriptions.get(subscription.id)).toBeUndefined();
    expect(await alerts.get(key('dead'))).toBeUndefined();
  });

  it('counts cleanup failures safely and continues checking other subscriptions', async () => {
    const secondSubscription: StoredSubscription = {
      ...subscription,
      id: 'subscription-parking-2',
      endpoint: 'https://fcm.googleapis.com/fcm/send/parking-check-2',
    };
    const sender = vi.fn()
      .mockRejectedValueOnce({ statusCode: 410 })
      .mockResolvedValueOnce(undefined);
    const dependencies = setup(vi.fn(async () => snapshot([facility('42', 1), facility('43', 1)])), sender);
    await subscriptions.set(secondSubscription.id, secondSubscription);
    await alerts.set(key('dead-cleanup'), alert('dead-cleanup', '42', 2));
    await alerts.set(`${secondSubscription.id}/healthy`, {
      ...alert('healthy', '43', 2),
      id: 'healthy',
      subscriptionId: secondSubscription.id,
    });
    const deleteAlert = alerts.delete.bind(alerts);
    vi.spyOn(alerts, 'delete').mockImplementation(async (storageKey) => {
      if (storageKey === key('dead-cleanup')) throw new Error('blob cleanup failed');
      await deleteAlert(storageKey);
    });

    const result = await runParkingAlertCheck(dependencies);

    expect(result.deadSubscriptions).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.sent).toBe(1);
    expect(await alerts.get(`${secondSubscription.id}/healthy`)).toBeUndefined();
  });

  it('deduplicates duplicate facility records and never sends twice when loser cleanup fails', async () => {
    const dependencies = setup(vi.fn(async () => snapshot([facility('42', 1)])));
    await alerts.set(key('dup-old'), alert('dup-old', '42', 2));
    await alerts.set(key('dup-new'), {
      ...alert('dup-new', '42', 2),
      id: 'dup-new',
      createdAt: '2026-08-22T00:00:01.000Z',
    });
    const deleteAlert = alerts.delete.bind(alerts);
    vi.spyOn(alerts, 'delete').mockImplementation(async (storageKey) => {
      if (storageKey === key('dup-old')) throw new Error('duplicate cleanup failed');
      await deleteAlert(storageKey);
    });

    const first = await runParkingAlertCheck(dependencies);
    const second = await runParkingAlertCheck(dependencies);

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('retries a failed dead-subscription cleanup on the next checker run', async () => {
    const sender = vi.fn()
      .mockRejectedValueOnce({ statusCode: 410 })
      .mockRejectedValueOnce({ statusCode: 410 });
    const dependencies = setup(vi.fn(async () => snapshot([facility('42', 1)])), sender);
    await alerts.set(key('dead-retry'), alert('dead-retry', '42', 2));
    const deleteAlert = alerts.delete.bind(alerts);
    let cleanupAttempts = 0;
    vi.spyOn(alerts, 'delete').mockImplementation(async (storageKey) => {
      if (storageKey === key('dead-retry') && cleanupAttempts++ === 0) {
        throw new Error('temporary cleanup failure');
      }
      await deleteAlert(storageKey);
    });

    const first = await runParkingAlertCheck(dependencies);
    expect(first.errors).toBe(1);
    expect(await alerts.get(key('dead-retry'))).toMatchObject({ state: 'pending' });
    expect(await subscriptions.get(subscription.id)).toBeDefined();

    const second = await runParkingAlertCheck(dependencies);
    expect(second.deadSubscriptions).toBe(0);
    expect(await alerts.get(key('dead-retry'))).toBeUndefined();
    expect(await subscriptions.get(subscription.id)).toBeUndefined();
  });

  it('keeps a dead-subscription marker when the final subscription delete fails, then retries with zero alerts', async () => {
    const fetchParking = vi.fn(async () => snapshot([facility('42', 1)]));
    const sender = vi.fn(async () => { throw { statusCode: 410 }; });
    const dependencies = setup(fetchParking, sender);
    await alerts.set(key('dead-marker'), alert('dead-marker', '42', 2));
    subscriptions.failNextDelete = new Error('subscription delete failed');

    const first = await runParkingAlertCheck(dependencies);

    expect(first.errors).toBe(1);
    expect(await alerts.list()).toHaveLength(0);
    expect(await subscriptions.get(subscription.id)).toBeDefined();
    expect(await deadCleanup.get(subscription.id)).toBeDefined();

    const second = await runParkingAlertCheck(dependencies);

    expect(second.errors).toBe(0);
    expect(await deadCleanup.get(subscription.id)).toBeUndefined();
    expect(await subscriptions.get(subscription.id)).toBeUndefined();
    expect(fetchParking).toHaveBeenCalledTimes(1);
  });

  it('keeps processing other alerts when the dead-subscription marker store fails', async () => {
    const secondSubscription: StoredSubscription = {
      ...subscription,
      id: 'subscription-marker-2',
      endpoint: 'https://fcm.googleapis.com/fcm/send/marker-2',
    };
    const sender = vi.fn()
      .mockRejectedValueOnce({ statusCode: 410 })
      .mockResolvedValueOnce(undefined);
    const dependencies = setup(vi.fn(async () => snapshot([facility('42', 1), facility('43', 1)])), sender);
    await subscriptions.set(secondSubscription.id, secondSubscription);
    await alerts.set(key('dead-marker-store'), alert('dead-marker-store', '42', 2));
    await alerts.set(`${secondSubscription.id}/healthy-marker-store`, {
      ...alert('healthy-marker-store', '43', 2),
      id: 'healthy-marker-store',
      subscriptionId: secondSubscription.id,
    });
    deadCleanup.failNextSet = new Error('marker store unavailable');

    const result = await runParkingAlertCheck(dependencies);

    expect(result.errors).toBeGreaterThanOrEqual(1);
    expect(result.sent).toBe(1);
    expect(await alerts.get(`${secondSubscription.id}/healthy-marker-store`)).toBeUndefined();
    expect(await subscriptions.get(secondSubscription.id)).toBeDefined();
  });
});
