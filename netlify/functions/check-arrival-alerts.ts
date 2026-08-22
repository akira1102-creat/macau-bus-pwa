import { randomBytes } from 'node:crypto';

import type { Config, Context } from '@netlify/functions';
import webpush from 'web-push';

import { remainingStopsToTarget } from '../../shared/arrival-distance';
import {
  RealtimeRouteResponseSchema,
  type DirectionId,
  type RealtimeBus,
  type RealtimeRouteResponse,
} from '../../shared/transit-contract';
import { getCatalogRepository } from './_shared/catalog';
import { readNetlifyEnv } from './_shared/env';
import { getNetlifyRuntime, type NetlifyRuntime } from './_shared/runtime';
import {
  StoredAlertSchema,
  type StoredAlert,
  type StoredSubscription,
} from './_shared/push-contract';
import {
  acquirePushMutationReservation,
  deleteSubscriptionAndAlerts,
  getDefaultPushDependencies,
  makeRandomId,
  PUSH_DELIVERY_CRITICAL_SECTION_TTL_MS,
  PUSH_PROVIDER_SOCKET_TIMEOUT_MS,
  releasePushMutationReservation,
  type PushStores,
  type PushReservationLease,
} from './_shared/push-store';
import type { CatalogRepository } from '../../src/data/catalog-repository';

export type ArrivalObservationFetcher = (
  routeId: string,
  direction: DirectionId,
) => Promise<RealtimeBus[] | RealtimeRouteResponse>;

export type ArrivalNotificationSender = (
  subscription: StoredSubscription,
  payload: string,
) => Promise<unknown>;

export interface ArrivalAlertCheckDependencies {
  stores: PushStores;
  catalog?: CatalogRepository;
  getCatalog?: () => Promise<CatalogRepository | undefined>;
  now?: () => Date;
  fetchRoute: ArrivalObservationFetcher;
  sendNotification: ArrivalNotificationSender;
  publicOrigin?: string;
  randomBytes?: (size: number) => Buffer;
}

export interface ArrivalAlertCheckResult {
  checked: number;
  sent: number;
  deleted: number;
  expired: number;
  retained: number;
  deadSubscriptions: number;
  errors: number;
}

interface PendingAlert {
  storageKey: string;
  alert: StoredAlert;
  subscription: StoredSubscription;
}

interface AlertGroup {
  routeId: string;
  direction: DirectionId;
  alerts: PendingAlert[];
}

const DEFAULT_PUBLIC_APP_URL = 'https://akira1102-creat.github.io/macau-bus-pwa/';

function currentDate(dependencies: Pick<ArrivalAlertCheckDependencies, 'now'>): Date {
  return dependencies.now?.() ?? new Date();
}

function pushStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined;
  const value = error.statusCode;
  return typeof value === 'number' ? value : undefined;
}

function routeObservation(value: RealtimeBus[] | RealtimeRouteResponse): { buses: RealtimeBus[]; stale: boolean } {
  return Array.isArray(value) ? { buses: value, stale: false } : { buses: value.buses, stale: value.stale };
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

function appUrl(dependencies: ArrivalAlertCheckDependencies): string {
  return validatedAppUrl(dependencies.publicOrigin ?? readNetlifyEnv('PUBLIC_APP_URL'));
}

function deepLink(baseUrl: string, routeId: string, direction: DirectionId): string {
  return `${baseUrl.replace(/\/+$/, '')}/?tab=routes&route=${encodeURIComponent(routeId)}&direction=${direction}`;
}

function notificationBody(
  alert: StoredAlert,
  candidate: RealtimeBus & { remainingStops: number },
): string {
  return `路線 ${alert.routeId} 方向 ${alert.direction}，站點 ${alert.targetStopId}，車牌 ${candidate.plate}，尚餘 ${candidate.remainingStops} 站`;
}

async function claimAlert(
  alertId: string,
  expected: StoredAlert,
  dependencies: ArrivalAlertCheckDependencies,
  now: Date,
): Promise<{ alert: StoredAlert; claimId: string } | undefined> {
  const current = await dependencies.stores.alerts.getWithMetadata(alertId);
  if (!current?.etag) return undefined;
  const parsed = StoredAlertSchema.safeParse(current.value);
  if (!parsed.success || parsed.data.state === 'delivered' || parsed.data.state === 'claimed'
    || !sameAlertVersion(parsed.data, expected)) return undefined;
  const claimId = makeRandomId(dependencies.randomBytes ?? randomBytes);
  const claimed = StoredAlertSchema.parse({
    ...parsed.data,
    state: 'claimed',
    claimId,
    claimExpiresAt: new Date(now.getTime() + PUSH_DELIVERY_CRITICAL_SECTION_TTL_MS).toISOString(),
  });
  return await dependencies.stores.alerts.setIfMatch(alertId, claimed, current.etag)
    ? { alert: claimed, claimId }
    : undefined;
}

function sameAlertVersion(left: StoredAlert, right: StoredAlert): boolean {
  return left.id === right.id
    && left.subscriptionId === right.subscriptionId
    && left.routeId === right.routeId
    && left.direction === right.direction
    && left.targetStopId === right.targetStopId
    && left.targetStopIndex === right.targetStopIndex
    && left.threshold === right.threshold
    && left.createdAt === right.createdAt
    && left.expiresAt === right.expiresAt;
}

async function reclaimExpiredAlertClaim(
  alertId: string,
  dependencies: ArrivalAlertCheckDependencies,
  now: Date,
): Promise<StoredAlert | undefined> {
  const current = await dependencies.stores.alerts.getWithMetadata(alertId);
  if (!current?.etag) return undefined;
  const parsed = StoredAlertSchema.safeParse(current.value);
  const claimExpiresAt = parsed.success && parsed.data.claimExpiresAt
    ? Date.parse(parsed.data.claimExpiresAt)
    : Number.NaN;
  if (!parsed.success || parsed.data.state !== 'claimed'
    || !Number.isFinite(claimExpiresAt) || claimExpiresAt > now.getTime()) return undefined;
  const pending = StoredAlertSchema.parse({ ...parsed.data, state: 'pending' });
  delete pending.claimId;
  delete pending.claimExpiresAt;
  return await dependencies.stores.alerts.setIfMatch(alertId, pending, current.etag)
    ? pending
    : undefined;
}

async function confirmAlertClaim(
  alertId: string,
  claimId: string,
  dependencies: ArrivalAlertCheckDependencies,
): Promise<boolean> {
  const current = await dependencies.stores.alerts.get(alertId);
  const parsed = current === undefined ? undefined : StoredAlertSchema.safeParse(current);
  return parsed?.success === true && parsed.data.state === 'claimed' && parsed.data.claimId === claimId;
}

async function markAlertDelivered(
  alertId: string,
  claimId: string,
  dependencies: ArrivalAlertCheckDependencies,
  now: Date,
): Promise<boolean> {
  const current = await dependencies.stores.alerts.getWithMetadata(alertId);
  if (!current?.etag) return false;
  const parsed = StoredAlertSchema.safeParse(current.value);
  if (!parsed.success || parsed.data.state !== 'claimed' || parsed.data.claimId !== claimId) return false;
  const delivered = StoredAlertSchema.parse({
    ...parsed.data,
    state: 'delivered',
    deliveredAt: now.toISOString(),
  });
  delete delivered.claimId;
  delete delivered.claimExpiresAt;
  return dependencies.stores.alerts.setIfMatch(alertId, delivered, current.etag);
}

async function releaseAlertClaim(
  alertId: string,
  claimId: string,
  dependencies: ArrivalAlertCheckDependencies,
): Promise<boolean> {
  const current = await dependencies.stores.alerts.getWithMetadata(alertId);
  if (!current?.etag) return false;
  const parsed = StoredAlertSchema.safeParse(current.value);
  if (!parsed.success || parsed.data.state !== 'claimed' || parsed.data.claimId !== claimId) return false;
  const pending = StoredAlertSchema.parse({
    ...parsed.data,
    state: 'pending',
  });
  delete pending.claimId;
  delete pending.claimExpiresAt;
  return dependencies.stores.alerts.setIfMatch(alertId, pending, current.etag);
}

function candidateForAlert(
  alert: StoredAlert,
  stopIds: readonly string[],
  buses: readonly RealtimeBus[],
): RealtimeBus & { remainingStops: number } | undefined {
  const candidates = buses.flatMap((bus) => {
    const remainingStops = remainingStopsToTarget(stopIds, bus.stationCode, alert.targetStopIndex);
    return remainingStops === null ? [] : [{ ...bus, remainingStops }];
  });
  return candidates.sort((left, right) => left.remainingStops - right.remainingStops || left.plate.localeCompare(right.plate))[0];
}

export function createArrivalObservationFetcher(
  runtime: Pick<NetlifyRuntime, 'client' | 'cache'> = getNetlifyRuntime(),
): ArrivalObservationFetcher {
  return async (routeId, direction) => {
    const result = await runtime.cache.get(`${routeId}|${direction}`, async () => {
      const upstream = await runtime.client.fetchRoute(routeId, direction);
      return RealtimeRouteResponseSchema.parse({
        route: routeId,
        direction,
        updatedAt: new Date().toISOString(),
        ageSeconds: 0,
        stale: false,
        source: 'DSAT observation',
        buses: upstream.buses,
      });
    });
    return RealtimeRouteResponseSchema.parse({
      ...result.value,
      ageSeconds: result.ageSeconds,
      stale: result.stale,
    });
  };
}

function defaultSender(): ArrivalNotificationSender {
  return async (subscription, payload) => {
    const publicKey = readNetlifyEnv('VAPID_PUBLIC_KEY');
    const privateKey = readNetlifyEnv('VAPID_PRIVATE_KEY');
    const subject = readNetlifyEnv('VAPID_SUBJECT') ?? 'https://akira1102-creat.github.io';
    if (!publicKey || !privateKey) {
      throw new Error('vapid-unavailable');
    }
    return webpush.sendNotification({
      endpoint: subscription.endpoint,
      keys: subscription.keys,
    }, payload, {
      vapidDetails: { subject, publicKey, privateKey },
      timeout: PUSH_PROVIDER_SOCKET_TIMEOUT_MS,
      TTL: 300,
      urgency: 'high',
    });
  };
}

async function defaultDependencies(): Promise<ArrivalAlertCheckDependencies> {
  const base = getDefaultPushDependencies();
  return {
    stores: base.stores,
    getCatalog: getCatalogRepository,
    fetchRoute: createArrivalObservationFetcher(),
    sendNotification: defaultSender(),
  };
}

async function catalogFor(dependencies: ArrivalAlertCheckDependencies): Promise<CatalogRepository | undefined> {
  if (dependencies.catalog) return dependencies.catalog;
  return dependencies.getCatalog?.() ?? getCatalogRepository();
}

export async function runArrivalAlertCheck(
  dependencies: ArrivalAlertCheckDependencies,
): Promise<ArrivalAlertCheckResult> {
  const result: ArrivalAlertCheckResult = {
    checked: 0,
    sent: 0,
    deleted: 0,
    expired: 0,
    retained: 0,
    deadSubscriptions: 0,
    errors: 0,
  };
  const now = currentDate(dependencies);
  const nowMilliseconds = now.getTime();
  const pending: PendingAlert[] = [];
  const subscriptionCache = new Map<string, StoredSubscription | undefined>();

  for (const key of await dependencies.stores.alerts.list()) {
    const value = await dependencies.stores.alerts.get(key);
    const parsed = value === undefined ? undefined : StoredAlertSchema.safeParse(value);
    if (!parsed?.success) {
      if (value !== undefined) {
        await dependencies.stores.alerts.delete(key);
        result.deleted += 1;
      }
      continue;
    }
    if (Date.parse(parsed.data.expiresAt) <= nowMilliseconds) {
      await dependencies.stores.alerts.delete(key);
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
        const reclaimed = await reclaimExpiredAlertClaim(key, dependencies, now);
        if (!reclaimed) {
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
      await dependencies.stores.alerts.delete(key);
      result.deleted += 1;
      continue;
    }
    pending.push({ storageKey: key, alert: activeAlert, subscription });
  }

  if (pending.length === 0) return result;
  const catalog = await catalogFor(dependencies);
  if (!catalog) {
    result.retained += pending.length;
    return result;
  }

  const groups = new Map<string, AlertGroup>();
  for (const item of pending) {
    const key = `${item.alert.routeId}|${item.alert.direction}`;
    const group = groups.get(key) ?? {
      routeId: item.alert.routeId,
      direction: item.alert.direction,
      alerts: [],
    };
    group.alerts.push(item);
    groups.set(key, group);
  }

  const deadSubscriptions = new Set<string>();
  for (const group of groups.values()) {
    const routeDirection = catalog.getDirection(group.routeId, group.direction);
    if (!routeDirection) {
      result.retained += group.alerts.length;
      continue;
    }
    let observation: ReturnType<typeof routeObservation>;
    try {
      observation = routeObservation(await dependencies.fetchRoute(group.routeId, group.direction));
    } catch {
      result.errors += 1;
      result.retained += group.alerts.length;
      continue;
    }
    if (observation.stale) {
      result.retained += group.alerts.length;
      continue;
    }
    const buses = observation.buses;

    for (const item of group.alerts) {
      if (deadSubscriptions.has(item.subscription.id)) continue;
      const targetIndex = routeDirection.stopIds[item.alert.targetStopIndex] === item.alert.targetStopId
        ? item.alert.targetStopIndex
        : -1;
      if (targetIndex < 0) {
        result.retained += 1;
        continue;
      }
      const candidate = candidateForAlert(item.alert, routeDirection.stopIds, buses);
      if (!candidate || candidate.remainingStops > item.alert.threshold) {
        result.retained += 1;
        continue;
      }

      let lease: PushReservationLease | undefined;
      try {
        lease = await acquirePushMutationReservation(
          dependencies.stores.reservations,
          item.subscription.id,
          now,
          dependencies.randomBytes ?? randomBytes,
          PUSH_DELIVERY_CRITICAL_SECTION_TTL_MS,
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
          if (!await confirmAlertClaim(item.storageKey, claimed.claimId, dependencies)) {
            await releaseAlertClaim(item.storageKey, claimed.claimId, dependencies);
            result.retained += 1;
            continue;
          }
        } catch {
          try { await releaseAlertClaim(item.storageKey, claimed.claimId, dependencies); } catch { /* next run can reclaim */ }
          result.errors += 1;
          result.retained += 1;
          continue;
        }

        const payload = JSON.stringify({
          title: '到站提醒',
          body: notificationBody(claimed.alert, candidate),
          route: claimed.alert.routeId,
          direction: claimed.alert.direction,
          stop: claimed.alert.targetStopId,
          plate: candidate.plate,
          remainingStops: candidate.remainingStops,
          url: deepLink(
            appUrl(dependencies),
            claimed.alert.routeId,
            claimed.alert.direction,
          ),
        });
        try {
          await dependencies.sendNotification(item.subscription, payload);
        } catch (error) {
          const status = pushStatus(error);
          if (status === 404 || status === 410) {
            deadSubscriptions.add(item.subscription.id);
            result.deadSubscriptions += 1;
            try {
              await deleteSubscriptionAndAlerts(item.subscription.id, dependencies.stores);
              result.deleted += group.alerts.filter((candidateAlert) => candidateAlert.subscription.id === item.subscription.id).length;
            } catch {
              try { await releaseAlertClaim(item.storageKey, claimed.claimId, dependencies); } catch { /* next run can reclaim */ }
              result.errors += 1;
              result.retained += 1;
            }
          } else {
            try { await releaseAlertClaim(item.storageKey, claimed.claimId, dependencies); } catch { /* next run can reclaim */ }
            result.errors += 1;
            result.retained += 1;
          }
          continue;
        }

        try {
          const delivered = await markAlertDelivered(item.storageKey, claimed.claimId, dependencies, now);
          if (!delivered) {
            try { await releaseAlertClaim(item.storageKey, claimed.claimId, dependencies); } catch { /* next run can reclaim */ }
            result.errors += 1;
            result.retained += 1;
            continue;
          }
          result.sent += 1;
          try {
            await dependencies.stores.alerts.delete(item.storageKey);
            result.deleted += 1;
          } catch {
            result.errors += 1;
            result.retained += 1;
          }
        } catch {
          try { await releaseAlertClaim(item.storageKey, claimed.claimId, dependencies); } catch { /* next run can reclaim */ }
          result.errors += 1;
          result.retained += 1;
        }
      } finally {
        try {
          await releasePushMutationReservation(
            dependencies.stores.reservations,
            item.subscription.id,
            lease,
            now,
          );
        } catch {
          // The lease expires and can be reclaimed by a later API/checker run.
        }
      }
    }
  }
  return result;
}

export default async function checkArrivalAlertsHandler(request: Request, context: Context): Promise<Response> {
  void request;
  void context;
  const dependencies = await defaultDependencies();
  const result = await runArrivalAlertCheck(dependencies);
  return new Response(JSON.stringify({ ok: true, ...result }), {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

export const config: Config = {
  schedule: '* * * * *',
};
