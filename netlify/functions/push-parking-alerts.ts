import { randomBytes } from 'node:crypto';

import type { Config, Context } from '@netlify/functions';

import { guardApiRequest, jsonResponse, type ApiRequestOptions } from './_shared/http';
import {
  ParkingAlertInputSchema,
  ParkingAlertSummarySchema,
  PushReservationSchema,
  StoredParkingAlertSchema,
  type PushReservation,
} from './_shared/push-contract';
import {
  authenticateSubscription,
  currentTime,
  getDefaultPushDependencies,
  getPushRateLimiter,
  makeRandomId,
  parkingAlertStorageKey,
  parkingAlertStoragePrefix,
  parkingAlertsStore,
  parkingReservationsStore,
  type PushApiDependencies,
  type StoredParkingAlert,
} from './_shared/push-store';

const API_OPTIONS: ApiRequestOptions = {
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: [
    'Accept',
    'Content-Type',
    'Authorization',
    'X-Subscription-Id',
    'X-Push-Subscription-Id',
  ],
};
const MUTATION_OPTIONS: ApiRequestOptions = { ...API_OPTIONS, requireTrustedOrigin: true };
const MAX_BODY_BYTES = 16 * 1024;
export const MAX_ACTIVE_PARKING_ALERTS = 10;
export const PARKING_ALERT_EXPIRY_MS = 12 * 60 * 60 * 1_000;
const RESERVATION_TTL_MS = 15_000;

interface ReservationLease {
  owner: string;
  etag: string;
}

function tooLarge(request: Request): boolean {
  const value = request.headers.get('content-length');
  if (value === null) return false;
  const length = Number.parseInt(value, 10);
  return Number.isFinite(length) && length > MAX_BODY_BYTES;
}

async function readActiveParkingAlerts(
  subscriptionId: string,
  dependencies: PushApiDependencies,
  now: Date,
): Promise<ReturnType<typeof ParkingAlertSummarySchema.parse>[]> {
  const store = parkingAlertsStore(dependencies.stores);
  const active: ReturnType<typeof ParkingAlertSummarySchema.parse>[] = [];
  for (const key of await store.list(parkingAlertStoragePrefix(subscriptionId))) {
    const value = await store.get(key);
    const parsed = value === undefined ? undefined : StoredParkingAlertSchema.safeParse(value);
    if (!parsed?.success || parsed.data.subscriptionId !== subscriptionId) {
      if (value !== undefined) await store.delete(key);
      continue;
    }
    if (Date.parse(parsed.data.expiresAt) <= now.getTime()) {
      await store.delete(key);
      continue;
    }
    active.push(ParkingAlertSummarySchema.parse(parsed.data));
  }
  return active.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

async function acquireReservation(
  subscriptionId: string,
  dependencies: PushApiDependencies,
  now: Date,
): Promise<ReservationLease | undefined> {
  const store = parkingReservationsStore(dependencies.stores);
  const owner = makeRandomId(dependencies.randomBytes ?? randomBytes);
  const next: PushReservation = {
    id: subscriptionId,
    subscriptionId,
    owner,
    expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS).toISOString(),
  };
  const existing = await store.getWithMetadata(subscriptionId);
  if (existing === undefined) {
    if (!await store.setIfNew(subscriptionId, next)) return undefined;
  } else {
    const parsed = PushReservationSchema.safeParse(existing.value);
    const expiresAt = parsed.success ? Date.parse(parsed.data.expiresAt) : Number.NaN;
    if (Number.isFinite(expiresAt) && expiresAt > now.getTime()) return undefined;
    if (!existing.etag || !await store.setIfMatch(subscriptionId, next, existing.etag)) return undefined;
  }
  const stored = await store.getWithMetadata(subscriptionId);
  const parsed = stored === undefined ? undefined : PushReservationSchema.safeParse(stored.value);
  return stored?.etag && parsed?.success && parsed.data.owner === owner ? { owner, etag: stored.etag } : undefined;
}

async function releaseReservation(
  subscriptionId: string,
  lease: ReservationLease,
  dependencies: PushApiDependencies,
  now: Date,
): Promise<void> {
  const store = parkingReservationsStore(dependencies.stores);
  const current = await store.getWithMetadata(subscriptionId);
  if (!current?.etag) return;
  const parsed = PushReservationSchema.safeParse(current.value);
  if (!parsed.success || parsed.data.owner !== lease.owner) return;
  await store.setIfMatch(subscriptionId, {
    ...parsed.data,
    expiresAt: new Date(now.getTime() - 1).toISOString(),
  }, current.etag);
}

function alertIdFromRequest(request: Request, context: Context): string {
  const fromContext = context.params?.alertId?.trim();
  if (fromContext) return fromContext;
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  return path.slice(path.lastIndexOf('/') + 1).trim();
}

export function createParkingPushAlertsHandler(
  dependencies: PushApiDependencies = getDefaultPushDependencies(),
): (request: Request, context: Context) => Promise<Response> {
  return async function parkingPushAlertsHandler(request: Request, context: Context): Promise<Response> {
    const isMutation = request.method === 'POST' || request.method === 'DELETE';
    const options = isMutation || request.method === 'GET' || request.method === 'OPTIONS'
      ? MUTATION_OPTIONS
      : API_OPTIONS;
    const guarded = guardApiRequest(request, options);
    if (guarded) return guarded;
    if (isMutation || request.method === 'GET') {
      const limiter = dependencies.rateLimiter ?? getPushRateLimiter();
      if (!limiter.allow(`parking-push-alerts:${context.ip?.trim() || 'unknown-client'}`)) {
        return jsonResponse(request, { error: 'rate-limit-exceeded' }, 429, {}, options);
      }
    }

    const subscription = await authenticateSubscription(request, dependencies.stores);
    if (!subscription) return jsonResponse(request, { error: 'unauthorized' }, 401, {}, options);
    const now = currentTime(dependencies);
    const store = parkingAlertsStore(dependencies.stores);

    if (request.method === 'GET') {
      try {
        return jsonResponse(request, { alerts: await readActiveParkingAlerts(subscription.id, dependencies, now) }, 200, {}, options);
      } catch {
        return jsonResponse(request, { error: 'storage-unavailable' }, 503, {}, options);
      }
    }

    if (request.method === 'DELETE') {
      const alertId = alertIdFromRequest(request, context);
      if (!alertId) return jsonResponse(request, { error: 'not-found' }, 404, {}, options);
      try {
        const value = await store.get(parkingAlertStorageKey(subscription.id, alertId));
        const parsed = value === undefined ? undefined : StoredParkingAlertSchema.safeParse(value);
        if (!parsed?.success || parsed.data.subscriptionId !== subscription.id) {
          return jsonResponse(request, { error: 'not-found' }, 404, {}, options);
        }
        await store.delete(parkingAlertStorageKey(subscription.id, alertId));
        return jsonResponse(request, { deleted: true }, 200, {}, options);
      } catch {
        return jsonResponse(request, { error: 'storage-unavailable' }, 503, {}, options);
      }
    }

    if (tooLarge(request)) return jsonResponse(request, { error: 'request-too-large' }, 413, {}, options);
    let payload: unknown;
    try {
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
        return jsonResponse(request, { error: 'request-too-large' }, 413, {}, options);
      }
      payload = JSON.parse(body) as unknown;
    } catch {
      return jsonResponse(request, { error: 'invalid-json' }, 400, {}, options);
    }
    const input = ParkingAlertInputSchema.safeParse(payload);
    if (!input.success) return jsonResponse(request, { error: 'invalid-alert' }, 400, {}, options);

    let lease: ReservationLease | undefined;
    try {
      lease = await acquireReservation(subscription.id, dependencies, now);
      if (!lease) return jsonResponse(request, { error: 'active-limit-busy' }, 409, {}, options);
      const active = await readActiveParkingAlerts(subscription.id, dependencies, now);
      const existing = active.find((alert) => alert.parkingId === input.data.parkingId);
      if (!existing && active.length >= MAX_ACTIVE_PARKING_ALERTS) {
        return jsonResponse(request, { error: 'active-limit' }, 409, {}, options);
      }
      if (existing) {
        await store.delete(parkingAlertStorageKey(subscription.id, existing.id));
      }
      const randomizer = dependencies.randomBytes ?? randomBytes;
      let id = makeRandomId(randomizer);
      for (let attempt = 0; attempt < 4 && await store.get(parkingAlertStorageKey(subscription.id, id)); attempt += 1) {
        id = makeRandomId(randomizer);
      }
      if (await store.get(parkingAlertStorageKey(subscription.id, id))) {
        return jsonResponse(request, { error: 'storage-unavailable' }, 503, {}, options);
      }
      const summary = ParkingAlertSummarySchema.parse({
        id,
        ...input.data,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + PARKING_ALERT_EXPIRY_MS).toISOString(),
      });
      const stored: StoredParkingAlert = { ...summary, subscriptionId: subscription.id, state: 'pending' };
      await store.set(parkingAlertStorageKey(subscription.id, summary.id), stored);
      return jsonResponse(request, summary, 201, {}, options);
    } catch {
      return jsonResponse(request, { error: 'storage-unavailable' }, 503, {}, options);
    } finally {
      if (lease) {
        try {
          await releaseReservation(subscription.id, lease, dependencies, now);
        } catch {
          // An expired reservation can be safely reclaimed on the next request.
        }
      }
    }
  };
}

export default async function pushParkingAlertsDefaultHandler(request: Request, context: Context): Promise<Response> {
  return createParkingPushAlertsHandler()(request, context);
}

export const config: Config = {
  path: ['/api/push/parking-alerts', '/api/push/parking-alerts/:alertId'],
  method: ['GET', 'POST', 'DELETE', 'OPTIONS'],
};
