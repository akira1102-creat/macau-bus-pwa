import { randomBytes } from 'node:crypto';

import type { Config, Context } from '@netlify/functions';
import webpush from 'web-push';

import { ParkingSnapshotSchema, type ParkingFacility, type ParkingSnapshot } from '../../shared/parking-contract';
import { getParkingRuntime } from '../../server/parking/runtime';
import { readNetlifyEnv } from './_shared/env';
import {
  acquirePushMutationReservation,
  deadSubscriptionCleanupKey,
  deadSubscriptionCleanupStore,
  deleteSubscriptionAndAlerts,
  getDefaultPushDependencies,
  makeRandomId,
  parkingAlertsStore,
  parkingReservationsStore,
  releasePushMutationReservation,
  type PushStores,
  type PushReservationLease,
  type StoredParkingAlert,
  type StoredSubscription,
} from './_shared/push-store';
import { DeadSubscriptionCleanupSchema, StoredParkingAlertSchema } from './_shared/push-contract';

export type ParkingSnapshotFetcher = () => Promise<ParkingSnapshot>;
export type ParkingNotificationSender = (subscription: StoredSubscription, payload: string) => Promise<unknown>;

export interface ParkingAlertCheckDependencies {
  stores: PushStores;
  now?: () => Date;
  fetchParking: ParkingSnapshotFetcher;
  sendNotification: ParkingNotificationSender;
  publicOrigin?: string;
  randomBytes?: (size: number) => Buffer;
}

export interface ParkingAlertCheckResult {
  checked: number;
  sent: number;
  deleted: number;
  expired: number;
  retained: number;
  deadSubscriptions: number;
  errors: number;
}

interface PendingParkingAlert {
  storageKey: string;
  alert: StoredParkingAlert;
  subscription: StoredSubscription;
}

const CLAIM_TTL_MS = 15_000;
const MAX_DEAD_SUBSCRIPTION_CLEANUPS_PER_RUN = 25;
const DEFAULT_PUBLIC_APP_URL = 'https://akira1102-creat.github.io/macau-bus-pwa/';

function currentDate(dependencies: Pick<ParkingAlertCheckDependencies, 'now'>): Date {
  return dependencies.now?.() ?? new Date();
}

function pushStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined;
  const value = error.statusCode;
  return typeof value === 'number' ? value : undefined;
}

function validatedAppUrl(value: string | undefined): string {
  if (!value) return DEFAULT_PUBLIC_APP_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) {
      return DEFAULT_PUBLIC_APP_URL;
    }
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${path}/`;
  } catch {
    return DEFAULT_PUBLIC_APP_URL;
  }
}

function appUrl(dependencies: ParkingAlertCheckDependencies): string {
  return validatedAppUrl(dependencies.publicOrigin ?? readNetlifyEnv('PUBLIC_APP_URL'));
}

function deepLink(baseUrl: string, parkingId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/?mode=parking&tab=detail&parking=${encodeURIComponent(parkingId)}&from=nearby`;
}

function facilityForAlert(facilities: readonly ParkingFacility[], alert: StoredParkingAlert): ParkingFacility | undefined {
  return facilities.find((facility) => facility.id === alert.parkingId);
}

function notificationBody(alert: StoredParkingAlert, facility: ParkingFacility): string {
  return `${facility.name}私家車剩餘 ${facility.spaces.car ?? '—'} 個車位（門檻 ${alert.threshold}）`;
}

async function claimAlert(
  storageKey: string,
  expected: StoredParkingAlert,
  dependencies: ParkingAlertCheckDependencies,
  now: Date,
): Promise<{ alert: StoredParkingAlert; claimId: string } | undefined> {
  const store = parkingAlertsStore(dependencies.stores);
  const current = await store.getWithMetadata(storageKey);
  if (!current?.etag) return undefined;
  const parsed = StoredParkingAlertSchema.safeParse(current.value);
  if (!parsed.success || parsed.data.state === 'delivered' || parsed.data.state === 'claimed'
    || !sameParkingAlertVersion(parsed.data, expected)) return undefined;
  const claimId = makeRandomId(dependencies.randomBytes ?? randomBytes);
  const claimed = StoredParkingAlertSchema.parse({
    ...parsed.data,
    state: 'claimed',
    claimId,
    claimExpiresAt: new Date(now.getTime() + CLAIM_TTL_MS).toISOString(),
  });
  return await store.setIfMatch(storageKey, claimed, current.etag)
    ? { alert: claimed, claimId }
    : undefined;
}

function sameParkingAlertVersion(left: StoredParkingAlert, right: StoredParkingAlert): boolean {
  return left.id === right.id
    && left.subscriptionId === right.subscriptionId
    && left.parkingId === right.parkingId
    && left.parkingName === right.parkingName
    && left.threshold === right.threshold
    && left.createdAt === right.createdAt
    && left.expiresAt === right.expiresAt;
}

async function reclaimExpiredClaim(
  storageKey: string,
  dependencies: ParkingAlertCheckDependencies,
  now: Date,
): Promise<StoredParkingAlert | undefined> {
  const store = parkingAlertsStore(dependencies.stores);
  const current = await store.getWithMetadata(storageKey);
  if (!current?.etag) return undefined;
  const parsed = StoredParkingAlertSchema.safeParse(current.value);
  const claimExpiresAt = parsed.success && parsed.data.claimExpiresAt
    ? Date.parse(parsed.data.claimExpiresAt)
    : Number.NaN;
  if (!parsed.success || parsed.data.state !== 'claimed'
    || !Number.isFinite(claimExpiresAt) || claimExpiresAt > now.getTime()) return undefined;
  const pending = StoredParkingAlertSchema.parse({ ...parsed.data, state: 'pending' });
  delete pending.claimId;
  delete pending.claimExpiresAt;
  return await store.setIfMatch(storageKey, pending, current.etag) ? pending : undefined;
}

async function confirmClaim(
  storageKey: string,
  claimId: string,
  dependencies: ParkingAlertCheckDependencies,
): Promise<boolean> {
  const current = await parkingAlertsStore(dependencies.stores).get(storageKey);
  const parsed = current === undefined ? undefined : StoredParkingAlertSchema.safeParse(current);
  return parsed?.success === true && parsed.data.state === 'claimed' && parsed.data.claimId === claimId;
}

async function markDelivered(
  storageKey: string,
  claimId: string,
  dependencies: ParkingAlertCheckDependencies,
  now: Date,
): Promise<boolean> {
  const store = parkingAlertsStore(dependencies.stores);
  const current = await store.getWithMetadata(storageKey);
  if (!current?.etag) return false;
  const parsed = StoredParkingAlertSchema.safeParse(current.value);
  if (!parsed.success || parsed.data.state !== 'claimed' || parsed.data.claimId !== claimId) return false;
  const delivered = StoredParkingAlertSchema.parse({ ...parsed.data, state: 'delivered', deliveredAt: now.toISOString() });
  delete delivered.claimId;
  delete delivered.claimExpiresAt;
  return store.setIfMatch(storageKey, delivered, current.etag);
}

async function releaseClaim(
  storageKey: string,
  claimId: string,
  dependencies: ParkingAlertCheckDependencies,
): Promise<boolean> {
  const store = parkingAlertsStore(dependencies.stores);
  const current = await store.getWithMetadata(storageKey);
  if (!current?.etag) return false;
  const parsed = StoredParkingAlertSchema.safeParse(current.value);
  if (!parsed.success || parsed.data.state !== 'claimed' || parsed.data.claimId !== claimId) return false;
  const pending = StoredParkingAlertSchema.parse({ ...parsed.data, state: 'pending' });
  delete pending.claimId;
  delete pending.claimExpiresAt;
  return store.setIfMatch(storageKey, pending, current.etag);
}

function pendingIsNewer(candidate: PendingParkingAlert, current: PendingParkingAlert): boolean {
  const candidateTime = Date.parse(candidate.alert.createdAt);
  const currentTime = Date.parse(current.alert.createdAt);
  return candidateTime > currentTime
    || (candidateTime === currentTime && candidate.alert.id.localeCompare(current.alert.id) > 0);
}

async function markDeadSubscription(
  subscriptionId: string,
  dependencies: ParkingAlertCheckDependencies,
  now: Date,
  result: ParkingAlertCheckResult,
): Promise<boolean> {
  const markerStore = deadSubscriptionCleanupStore(dependencies.stores);
  if (!markerStore) {
    result.errors += 1;
    return false;
  }
  const id = deadSubscriptionCleanupKey(subscriptionId);
  try {
    await markerStore.set(id, DeadSubscriptionCleanupSchema.parse({
      id,
      subscriptionId,
      createdAt: now.toISOString(),
    }));
    return true;
  } catch {
    result.errors += 1;
    return false;
  }
}

async function retryDeadSubscriptionCleanups(
  dependencies: ParkingAlertCheckDependencies,
  result: ParkingAlertCheckResult,
  skipKeys: ReadonlySet<string> = new Set(),
): Promise<void> {
  const markerStore = deadSubscriptionCleanupStore(dependencies.stores);
  if (!markerStore) return;

  let keys: string[];
  try {
    keys = (await markerStore.list()).slice(0, MAX_DEAD_SUBSCRIPTION_CLEANUPS_PER_RUN);
  } catch {
    result.errors += 1;
    return;
  }

  for (const key of keys) {
    if (skipKeys.has(key)) continue;
    let value;
    try {
      value = await markerStore.get(key);
    } catch {
      result.errors += 1;
      continue;
    }
    if (value === undefined) continue;
    const parsed = DeadSubscriptionCleanupSchema.safeParse(value);
    if (!parsed.success) {
      result.errors += 1;
      continue;
    }
    try {
      await deleteSubscriptionAndAlerts(parsed.data.subscriptionId, dependencies.stores);
    } catch {
      // Keep the marker so a later scheduled run can resume the partial cleanup.
      result.errors += 1;
      continue;
    }
    try {
      await markerStore.delete(key);
    } catch {
      // Cleanup succeeded, but retaining the marker makes deletion retry-safe.
      result.errors += 1;
    }
  }
}

async function suppressDuplicate(
  duplicate: PendingParkingAlert,
  dependencies: ParkingAlertCheckDependencies,
  now: Date,
  result: ParkingAlertCheckResult,
): Promise<void> {
  const store = parkingAlertsStore(dependencies.stores);
  try {
    await store.delete(duplicate.storageKey);
    result.deleted += 1;
    return;
  } catch {
    // A retained duplicate must not become a second notification on the next run.
  }
  try {
    const current = await store.get(duplicate.storageKey);
    const parsed = current === undefined ? undefined : StoredParkingAlertSchema.safeParse(current);
    if (!parsed?.success) return;
    const delivered = StoredParkingAlertSchema.parse({
      ...parsed.data,
      state: 'delivered',
      deliveredAt: now.toISOString(),
    });
    delete delivered.claimId;
    delete delivered.claimExpiresAt;
    await store.set(duplicate.storageKey, delivered);
  } catch {
    result.errors += 1;
  }
}

function defaultFetchParking(): ParkingSnapshotFetcher {
  const runtime = getParkingRuntime();
  return async () => ParkingSnapshotSchema.parse(await runtime.fetchSnapshot());
}

function defaultSender(): ParkingNotificationSender {
  return async (subscription, payload) => {
    const publicKey = readNetlifyEnv('VAPID_PUBLIC_KEY');
    const privateKey = readNetlifyEnv('VAPID_PRIVATE_KEY');
    const subject = readNetlifyEnv('VAPID_SUBJECT') ?? 'https://akira1102-creat.github.io';
    if (!publicKey || !privateKey) throw new Error('vapid-unavailable');
    return webpush.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys }, payload, {
      vapidDetails: { subject, publicKey, privateKey },
      TTL: 300,
      urgency: 'high',
    });
  };
}

async function defaultDependencies(): Promise<ParkingAlertCheckDependencies> {
  const base = getDefaultPushDependencies();
  return { stores: base.stores, fetchParking: defaultFetchParking(), sendNotification: defaultSender() };
}

export async function runParkingAlertCheck(dependencies: ParkingAlertCheckDependencies): Promise<ParkingAlertCheckResult> {
  const result: ParkingAlertCheckResult = { checked: 0, sent: 0, deleted: 0, expired: 0, retained: 0, deadSubscriptions: 0, errors: 0 };
  const now = currentDate(dependencies);
  const store = parkingAlertsStore(dependencies.stores);
  const createdDeadMarkers = new Set<string>();
  await retryDeadSubscriptionCleanups(dependencies, result);
  const pending: PendingParkingAlert[] = [];
  const claimedFacilities = new Set<string>();
  const subscriptionCache = new Map<string, StoredSubscription | undefined>();

  for (const storageKey of await store.list()) {
    const value = await store.get(storageKey);
    const parsed = value === undefined ? undefined : StoredParkingAlertSchema.safeParse(value);
    if (!parsed?.success) {
      if (value !== undefined) { await store.delete(storageKey); result.deleted += 1; }
      continue;
    }
    if (Date.parse(parsed.data.expiresAt) <= now.getTime()) {
      await store.delete(storageKey);
      result.expired += 1;
      result.deleted += 1;
      continue;
    }
    let activeAlert = parsed.data;
    if (activeAlert.state === 'delivered') {
      result.retained += 1;
      continue;
    }
    if (activeAlert.state === 'claimed') {
      try {
        const reclaimed = await reclaimExpiredClaim(storageKey, dependencies, now);
        if (!reclaimed) {
          claimedFacilities.add(`${activeAlert.subscriptionId}\u0000${activeAlert.parkingId}`);
          result.retained += 1;
          continue;
        }
        activeAlert = reclaimed;
      } catch {
        result.errors += 1;
        result.retained += 1;
        continue;
      }
    }
    result.checked += 1;
    let subscription = subscriptionCache.get(activeAlert.subscriptionId);
    if (subscription === undefined && !subscriptionCache.has(activeAlert.subscriptionId)) {
      subscription = await dependencies.stores.subscriptions.get(activeAlert.subscriptionId);
      subscriptionCache.set(activeAlert.subscriptionId, subscription);
    }
    if (!subscription) {
      await store.delete(storageKey);
      result.deleted += 1;
      continue;
    }
    pending.push({ storageKey, alert: activeAlert, subscription });
  }

  const uniquePending = new Map<string, PendingParkingAlert>();
  for (const candidate of pending) {
    const facilityKey = `${candidate.subscription.id}\u0000${candidate.alert.parkingId}`;
    if (claimedFacilities.has(facilityKey)) {
      result.retained += 1;
      continue;
    }
    const current = uniquePending.get(facilityKey);
    if (!current) {
      uniquePending.set(facilityKey, candidate);
      continue;
    }
    if (pendingIsNewer(candidate, current)) {
      await suppressDuplicate(current, dependencies, now, result);
      uniquePending.set(facilityKey, candidate);
    } else {
      await suppressDuplicate(candidate, dependencies, now, result);
    }
  }
  const deduplicatedPending = [...uniquePending.values()];

  if (deduplicatedPending.length === 0) {
    await retryDeadSubscriptionCleanups(dependencies, result, createdDeadMarkers);
    return result;
  }

  let snapshot: ParkingSnapshot;
  try {
    snapshot = ParkingSnapshotSchema.parse(await dependencies.fetchParking());
  } catch {
    result.errors += 1;
    result.retained += deduplicatedPending.length;
    return result;
  }
  if (snapshot.stale) {
    result.retained += deduplicatedPending.length;
    await retryDeadSubscriptionCleanups(dependencies, result, createdDeadMarkers);
    return result;
  }

  const deadSubscriptions = new Set<string>();
  for (const item of deduplicatedPending) {
    if (deadSubscriptions.has(item.subscription.id)) continue;
    const facility = facilityForAlert(snapshot.facilities, item.alert);
    const freeSpaces = facility?.suspended ? null : facility?.spaces.car ?? null;
    if (!facility || freeSpaces === null || freeSpaces > item.alert.threshold) {
      result.retained += 1;
      continue;
    }

    let lease: PushReservationLease | undefined;
    try {
      lease = await acquirePushMutationReservation(
        parkingReservationsStore(dependencies.stores),
        item.subscription.id,
        now,
        dependencies.randomBytes ?? randomBytes,
      );
    } catch {
      result.errors += 1;
      result.retained += 1;
      continue;
    }
    if (!lease) {
      result.retained += 1;
      continue;
    }
    try {
      let claimed: Awaited<ReturnType<typeof claimAlert>>;
      try {
        claimed = await claimAlert(item.storageKey, item.alert, dependencies, now);
      } catch {
        result.errors += 1;
        result.retained += 1;
        continue;
      }
      if (!claimed) {
        result.retained += 1;
        continue;
      }
      try {
        if (!await confirmClaim(item.storageKey, claimed.claimId, dependencies)) {
          await releaseClaim(item.storageKey, claimed.claimId, dependencies);
          result.retained += 1;
          continue;
        }
      } catch {
        try { await releaseClaim(item.storageKey, claimed.claimId, dependencies); } catch { /* next run can reclaim */ }
        result.errors += 1;
        result.retained += 1;
        continue;
      }

      const payload = JSON.stringify({
        title: '泊車低空位提醒',
        body: notificationBody(claimed.alert, facility),
        parkingId: claimed.alert.parkingId,
        parkingName: facility.name,
        freeSpaces,
        threshold: claimed.alert.threshold,
        url: deepLink(appUrl(dependencies), claimed.alert.parkingId),
      });
      try {
        await dependencies.sendNotification(item.subscription, payload);
      } catch (error) {
        const status = pushStatus(error);
        if (status === 404 || status === 410) {
          deadSubscriptions.add(item.subscription.id);
          result.deadSubscriptions += 1;
          const markerKey = deadSubscriptionCleanupKey(item.subscription.id);
          const markerStored = await markDeadSubscription(item.subscription.id, dependencies, now, result);
          if (markerStored) createdDeadMarkers.add(markerKey);
          try {
            await deleteSubscriptionAndAlerts(item.subscription.id, dependencies.stores);
            result.deleted += deduplicatedPending.filter((candidate) => candidate.subscription.id === item.subscription.id).length;
            if (markerStored) {
              const markerStore = deadSubscriptionCleanupStore(dependencies.stores);
              if (markerStore) {
                try {
                  await markerStore.delete(markerKey);
                } catch {
                  // Leave the marker for the next run if clearing it fails.
                  result.errors += 1;
                }
              }
            }
          } catch {
            // A dead provider must not abort the rest of the scheduled run.
            result.errors += 1;
            try {
              await releaseClaim(item.storageKey, claimed.claimId, dependencies);
            } catch {
              result.errors += 1;
            }
          }
        } else {
          try { await releaseClaim(item.storageKey, claimed.claimId, dependencies); } catch { /* next run can reclaim */ }
          result.errors += 1;
          result.retained += 1;
        }
        continue;
      }

      try {
        if (!await markDelivered(item.storageKey, claimed.claimId, dependencies, now)) {
          try { await releaseClaim(item.storageKey, claimed.claimId, dependencies); } catch { /* next run can reclaim */ }
          result.errors += 1;
          result.retained += 1;
          continue;
        }
        result.sent += 1;
        try {
          await store.delete(item.storageKey);
          result.deleted += 1;
        } catch {
          result.errors += 1;
          result.retained += 1;
        }
      } catch {
        try { await releaseClaim(item.storageKey, claimed.claimId, dependencies); } catch { /* next run can reclaim */ }
        result.errors += 1;
        result.retained += 1;
      }
    } finally {
      try {
        await releasePushMutationReservation(
          parkingReservationsStore(dependencies.stores),
          item.subscription.id,
          lease,
          now,
        );
      } catch {
        // The lease expires and can be reclaimed by a later API/checker run.
      }
    }
  }
  await retryDeadSubscriptionCleanups(dependencies, result, createdDeadMarkers);
  return result;
}

export default async function checkParkingAlertsHandler(request: Request, context: Context): Promise<Response> {
  void request;
  void context;
  const result = await runParkingAlertCheck(await defaultDependencies());
  return new Response(JSON.stringify({ ok: true, ...result }), {
    status: 200,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const config: Config = { schedule: '* * * * *' };
