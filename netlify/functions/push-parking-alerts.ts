import { randomBytes } from 'node:crypto';

import type { Config, Context } from '@netlify/functions';

import { guardApiRequest, jsonResponse, type ApiRequestOptions } from './_shared/http';
import {
  ParkingAlertInputSchema,
  ParkingAlertSummarySchema,
  StoredParkingAlertSchema,
} from './_shared/push-contract';
import {
  acquirePushMutationReservation,
  authenticateSubscription,
  currentTime,
  getDefaultPushDependencies,
  getPushRateLimiter,
  makeRandomId,
  parkingAlertStorageKey,
  parkingAlertStoragePrefix,
  parkingAlertsStore,
  parkingReservationsStore,
  releasePushMutationReservation,
  type PushApiDependencies,
  type PushReservationLease,
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
  const active = new Map<string, { summary: ReturnType<typeof ParkingAlertSummarySchema.parse>; storageKey: string }>();
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
    if (parsed.data.state === 'delivered') {
      await store.delete(key);
      continue;
    }
    const summary = ParkingAlertSummarySchema.parse(parsed.data);
    const current = active.get(summary.parkingId);
    if (!current) {
      active.set(summary.parkingId, { summary, storageKey: key });
      continue;
    }
    const currentTime = Date.parse(current.summary.createdAt);
    const candidateTime = Date.parse(summary.createdAt);
    const candidateWins = candidateTime > currentTime
      || (candidateTime === currentTime && summary.id.localeCompare(current.summary.id) > 0);
    const loserKey = candidateWins ? current.storageKey : key;
    if (candidateWins) active.set(summary.parkingId, { summary, storageKey: key });
    try {
      await store.delete(loserKey);
    } catch {
      // Keep the deterministic winner in the response; checker dedupe handles a retained loser.
    }
  }
  return [...active.values()]
    .map(({ summary }) => summary)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
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

    let subscription: Awaited<ReturnType<typeof authenticateSubscription>>;
    try {
      subscription = await authenticateSubscription(request, dependencies.stores);
    } catch {
      return jsonResponse(request, { error: 'storage-unavailable' }, 503, {}, options);
    }
    if (!subscription) return jsonResponse(request, { error: 'unauthorized' }, 401, {}, options);
    const now = currentTime(dependencies);
    let store: ReturnType<typeof parkingAlertsStore>;
    try {
      store = parkingAlertsStore(dependencies.stores);
    } catch {
      return jsonResponse(request, { error: 'storage-unavailable' }, 503, {}, options);
    }

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
      let lease: PushReservationLease | undefined;
      try {
        lease = await acquirePushMutationReservation(
          parkingReservationsStore(dependencies.stores),
          subscription.id,
          now,
          dependencies.randomBytes ?? randomBytes,
        );
        if (!lease) return jsonResponse(request, { error: 'active-limit-busy' }, 409, {}, options);
        const value = await store.get(parkingAlertStorageKey(subscription.id, alertId));
        const parsed = value === undefined ? undefined : StoredParkingAlertSchema.safeParse(value);
        if (!parsed?.success || parsed.data.subscriptionId !== subscription.id) {
          return jsonResponse(request, { error: 'not-found' }, 404, {}, options);
        }
        await store.delete(parkingAlertStorageKey(subscription.id, alertId));
        return jsonResponse(request, { deleted: true }, 200, {}, options);
      } catch {
        return jsonResponse(request, { error: 'storage-unavailable' }, 503, {}, options);
      } finally {
        if (lease) {
          try {
            await releasePushMutationReservation(
              parkingReservationsStore(dependencies.stores),
              subscription.id,
              lease,
              now,
            );
          } catch {
            // An expired reservation can be safely reclaimed on the next request.
          }
        }
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

    let lease: PushReservationLease | undefined;
    try {
      lease = await acquirePushMutationReservation(
        parkingReservationsStore(dependencies.stores),
        subscription.id,
        now,
        dependencies.randomBytes ?? randomBytes,
      );
      if (!lease) return jsonResponse(request, { error: 'active-limit-busy' }, 409, {}, options);
      const active = await readActiveParkingAlerts(subscription.id, dependencies, now);
      const existing = active.find((alert) => alert.parkingId === input.data.parkingId);
      if (!existing && active.length >= MAX_ACTIVE_PARKING_ALERTS) {
        return jsonResponse(request, { error: 'active-limit' }, 409, {}, options);
      }
      let id = existing?.id;
      if (!id) {
        const randomizer = dependencies.randomBytes ?? randomBytes;
        id = makeRandomId(randomizer);
        for (let attempt = 0; attempt < 4 && await store.get(parkingAlertStorageKey(subscription.id, id)); attempt += 1) {
          id = makeRandomId(randomizer);
        }
        if (await store.get(parkingAlertStorageKey(subscription.id, id))) {
          return jsonResponse(request, { error: 'storage-unavailable' }, 503, {}, options);
        }
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
          await releasePushMutationReservation(
            parkingReservationsStore(dependencies.stores),
            subscription.id,
            lease,
            now,
          );
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
