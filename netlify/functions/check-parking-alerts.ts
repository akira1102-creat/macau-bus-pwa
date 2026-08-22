import { randomBytes } from 'node:crypto';

import type { Config, Context } from '@netlify/functions';
import webpush from 'web-push';

import { ParkingSnapshotSchema, type ParkingFacility, type ParkingSnapshot } from '../../shared/parking-contract';
import { getParkingRuntime } from '../../server/parking/runtime';
import { readNetlifyEnv } from './_shared/env';
import { getDefaultPushDependencies, makeRandomId, parkingAlertsStore, type PushStores, type StoredParkingAlert, type StoredSubscription } from './_shared/push-store';
import { deleteSubscriptionAndAlerts } from './_shared/push-store';
import { StoredParkingAlertSchema } from './_shared/push-contract';

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
const DEFAULT_PUBLIC_APP_URL = 'https://akira1102-creat.github.io/macau-bus-pwa/';

function currentDate(dependencies: Pick<ParkingAlertCheckDependencies, 'now'>): Date {
  return dependencies.now?.() ?? new Date();
}

function pushStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined;
  const value = error.statusCode;
  return typeof value === 'number' ? value : undefined;
}

function isTransientPushFailure(error: unknown): boolean {
  const status = pushStatus(error);
  return status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500);
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
  dependencies: ParkingAlertCheckDependencies,
  now: Date,
): Promise<string | undefined> {
  const store = parkingAlertsStore(dependencies.stores);
  const current = await store.getWithMetadata(storageKey);
  if (!current?.etag) return undefined;
  const parsed = StoredParkingAlertSchema.safeParse(current.value);
  if (!parsed.success || parsed.data.state === 'delivered' || parsed.data.state === 'claimed') return undefined;
  const claimId = makeRandomId(dependencies.randomBytes ?? randomBytes);
  const claimed = StoredParkingAlertSchema.parse({
    ...parsed.data,
    state: 'claimed',
    claimId,
    claimExpiresAt: new Date(now.getTime() + CLAIM_TTL_MS).toISOString(),
  });
  return await store.setIfMatch(storageKey, claimed, current.etag) ? claimId : undefined;
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
  const pending: PendingParkingAlert[] = [];
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
    if (parsed.data.state === 'delivered' || parsed.data.state === 'claimed') {
      result.retained += 1;
      continue;
    }
    result.checked += 1;
    let subscription = subscriptionCache.get(parsed.data.subscriptionId);
    if (subscription === undefined && !subscriptionCache.has(parsed.data.subscriptionId)) {
      subscription = await dependencies.stores.subscriptions.get(parsed.data.subscriptionId);
      subscriptionCache.set(parsed.data.subscriptionId, subscription);
    }
    if (!subscription) {
      await store.delete(storageKey);
      result.deleted += 1;
      continue;
    }
    pending.push({ storageKey, alert: parsed.data, subscription });
  }

  if (pending.length === 0) return result;

  let snapshot: ParkingSnapshot;
  try {
    snapshot = ParkingSnapshotSchema.parse(await dependencies.fetchParking());
  } catch {
    result.errors += 1;
    result.retained += pending.length;
    return result;
  }

  const deadSubscriptions = new Set<string>();
  for (const item of pending) {
    if (deadSubscriptions.has(item.subscription.id)) continue;
    const facility = facilityForAlert(snapshot.facilities, item.alert);
    const freeSpaces = facility?.suspended ? null : facility?.spaces.car ?? null;
    if (!facility || freeSpaces === null || freeSpaces > item.alert.threshold) {
      result.retained += 1;
      continue;
    }

    let claimId: string | undefined;
    try {
      claimId = await claimAlert(item.storageKey, dependencies, now);
    } catch {
      result.errors += 1;
      result.retained += 1;
      continue;
    }
    if (!claimId) {
      result.retained += 1;
      continue;
    }

    const payload = JSON.stringify({
      title: '泊車低空位提醒',
      body: notificationBody(item.alert, facility),
      parkingId: item.alert.parkingId,
      parkingName: facility.name,
      freeSpaces,
      threshold: item.alert.threshold,
      url: deepLink(appUrl(dependencies), item.alert.parkingId),
    });
    try {
      await dependencies.sendNotification(item.subscription, payload);
    } catch (error) {
      const status = pushStatus(error);
      if (status === 404 || status === 410) {
        deadSubscriptions.add(item.subscription.id);
        result.deadSubscriptions += 1;
        await deleteSubscriptionAndAlerts(item.subscription.id, dependencies.stores);
        result.deleted += pending.filter((candidate) => candidate.subscription.id === item.subscription.id).length;
      } else {
        if (isTransientPushFailure(error)) {
          try { await releaseClaim(item.storageKey, claimId, dependencies); } catch { /* retry can reclaim after expiry */ }
        }
        result.errors += 1;
        result.retained += 1;
      }
      continue;
    }

    try {
      if (!await markDelivered(item.storageKey, claimId, dependencies, now)) {
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
      result.errors += 1;
      result.retained += 1;
    }
  }
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
