import { randomBytes } from 'node:crypto';

import type { Config, Context } from '@netlify/functions';

import { getCatalogRepository } from './_shared/catalog';
import { guardApiRequest, jsonResponse, type ApiRequestOptions } from './_shared/http';
import {
  ArrivalAlertInputSchema,
  ArrivalAlertSummarySchema,
  StoredAlertSchema,
} from './_shared/push-contract';
import {
  acquirePushMutationReservation,
  authenticateSubscription,
  alertStorageKey,
  alertStoragePrefix,
  currentTime,
  getPushRateLimiter,
  getDefaultPushDependencies,
  makeRandomId,
  releasePushMutationReservation,
  type PushApiDependencies,
  type PushReservationLease,
} from './_shared/push-store';

const ALERTS_API_OPTIONS: ApiRequestOptions = {
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: [
    'Accept',
    'Content-Type',
    'Authorization',
    'X-Subscription-Id',
    'X-Push-Subscription-Id',
  ],
};
const ALERTS_MUTATION_API_OPTIONS: ApiRequestOptions = {
  ...ALERTS_API_OPTIONS,
  requireTrustedOrigin: true,
};
const MAX_ALERT_BODY_BYTES = 16 * 1024;
const MAX_ACTIVE_ALERTS = 5;
const ALERT_EXPIRY_MS = 4 * 60 * 60 * 1_000;

function tooLarge(request: Request): boolean {
  const value = request.headers.get('content-length');
  if (value === null) return false;
  const length = Number.parseInt(value, 10);
  return Number.isFinite(length) && length > MAX_ALERT_BODY_BYTES;
}

async function readActiveAlerts(
  subscriptionId: string,
  dependencies: PushApiDependencies,
  now: Date,
): Promise<ReturnType<typeof ArrivalAlertSummarySchema.parse>[]> {
  const active: ReturnType<typeof ArrivalAlertSummarySchema.parse>[] = [];
  const nowMilliseconds = now.getTime();
  for (const key of await dependencies.stores.alerts.list(alertStoragePrefix(subscriptionId))) {
    const value = await dependencies.stores.alerts.get(key);
    const parsed = value === undefined ? undefined : StoredAlertSchema.safeParse(value);
    if (!parsed?.success) {
      if (value !== undefined) await dependencies.stores.alerts.delete(key);
      continue;
    }
    if (parsed.data.subscriptionId !== subscriptionId) continue;
    if (Date.parse(parsed.data.expiresAt) <= nowMilliseconds) {
      await dependencies.stores.alerts.delete(key);
      continue;
    }
    active.push(ArrivalAlertSummarySchema.parse(parsed.data));
  }
  return active.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

async function catalogFor(dependencies: PushApiDependencies) {
  if (dependencies.catalog) return dependencies.catalog;
  return dependencies.getCatalog?.() ?? getCatalogRepository();
}

function alertIdFromRequest(request: Request, context: Context): string {
  const fromContext = context.params?.alertId?.trim();
  if (fromContext) return fromContext;
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  return path.slice(path.lastIndexOf('/') + 1).trim();
}

export function createPushAlertsHandler(
  dependencies: PushApiDependencies = getDefaultPushDependencies(),
): (request: Request, context: Context) => Promise<Response> {
  return async function pushAlertsHandler(request: Request, context: Context): Promise<Response> {
    const isMutation = request.method === 'POST' || request.method === 'DELETE';
    const apiOptions = isMutation || request.method === 'GET' || request.method === 'OPTIONS'
      ? ALERTS_MUTATION_API_OPTIONS
      : ALERTS_API_OPTIONS;
    const guarded = guardApiRequest(request, apiOptions);
    if (guarded) return guarded;
    if (isMutation || request.method === 'GET') {
      const rateLimiter = dependencies.rateLimiter ?? getPushRateLimiter();
      const clientKey = `push-alerts:${context.ip?.trim() || 'unknown-client'}`;
      if (!rateLimiter.allow(clientKey)) {
        return jsonResponse(request, { error: 'rate-limit-exceeded' }, 429, {}, apiOptions);
      }
    }

    let subscription: Awaited<ReturnType<typeof authenticateSubscription>>;
    try {
      subscription = await authenticateSubscription(request, dependencies.stores);
    } catch {
      return jsonResponse(request, { error: 'storage-unavailable' }, 503, {}, apiOptions);
    }
    if (!subscription) {
      return jsonResponse(request, { error: 'unauthorized' }, 401, {}, apiOptions);
    }
    const now = currentTime(dependencies);

    if (request.method === 'GET') {
      const alerts = await readActiveAlerts(subscription.id, dependencies, now);
      return jsonResponse(request, { alerts }, 200, {}, apiOptions);
    }

    if (request.method === 'DELETE') {
      const alertId = alertIdFromRequest(request, context);
      if (!alertId) {
        return jsonResponse(request, { error: 'not-found' }, 404, {}, apiOptions);
      }
      let lease: PushReservationLease | undefined;
      try {
        lease = await acquirePushMutationReservation(
          dependencies.stores.reservations,
          subscription.id,
          now,
          dependencies.randomBytes ?? randomBytes,
        );
        if (!lease) return jsonResponse(request, { error: 'active-limit-busy' }, 409, {}, apiOptions);
        const value = await dependencies.stores.alerts.get(alertStorageKey(subscription.id, alertId));
        const parsed = value === undefined ? undefined : StoredAlertSchema.safeParse(value);
        if (!parsed?.success || parsed.data.subscriptionId !== subscription.id) {
          return jsonResponse(request, { error: 'not-found' }, 404, {}, apiOptions);
        }
        await dependencies.stores.alerts.delete(alertStorageKey(subscription.id, alertId));
        return jsonResponse(request, { deleted: true }, 200, {}, apiOptions);
      } catch {
        return jsonResponse(request, { error: 'storage-unavailable' }, 503, {}, apiOptions);
      } finally {
        if (lease) {
          try {
            await releasePushMutationReservation(dependencies.stores.reservations, subscription.id, lease, now);
          } catch {
            // An expired reservation is safe to reclaim on the next request.
          }
        }
      }
    }

    if (tooLarge(request)) {
      return jsonResponse(request, { error: 'request-too-large' }, 413, {}, apiOptions);
    }

    let payload: unknown;
    try {
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_ALERT_BODY_BYTES) {
        return jsonResponse(request, { error: 'request-too-large' }, 413, {}, apiOptions);
      }
      payload = JSON.parse(body) as unknown;
    } catch {
      return jsonResponse(request, { error: 'invalid-json' }, 400, {}, apiOptions);
    }
    const input = ArrivalAlertInputSchema.safeParse(payload);
    if (!input.success) {
      return jsonResponse(request, { error: 'invalid-alert' }, 400, {}, apiOptions);
    }

    const catalog = await catalogFor(dependencies);
    if (!catalog) {
      return jsonResponse(request, { error: 'catalog-unavailable' }, 503, {}, apiOptions);
    }
    const routeDirection = catalog.getDirection(input.data.routeId, input.data.direction);
    if (!routeDirection || routeDirection.stopIds[input.data.targetStopIndex] !== input.data.targetStopId) {
      return jsonResponse(request, { error: 'invalid-alert' }, 400, {}, apiOptions);
    }

    let lease: PushReservationLease | undefined;
    try {
      lease = await acquirePushMutationReservation(
        dependencies.stores.reservations,
        subscription.id,
        now,
        dependencies.randomBytes ?? randomBytes,
      );
      if (!lease) {
        return jsonResponse(request, { error: 'active-limit-busy' }, 409, {}, apiOptions);
      }
      const active = await readActiveAlerts(subscription.id, dependencies, now);
      if (active.length >= MAX_ACTIVE_ALERTS) {
        return jsonResponse(request, { error: 'active-limit' }, 409, {}, apiOptions);
      }

      const randomizer = dependencies.randomBytes ?? randomBytes;
      let id = makeRandomId(randomizer);
      for (let attempt = 0; attempt < 4 && await dependencies.stores.alerts.get(alertStorageKey(subscription.id, id)); attempt += 1) {
        id = makeRandomId(randomizer);
      }
      if (await dependencies.stores.alerts.get(alertStorageKey(subscription.id, id))) {
        return jsonResponse(request, { error: 'storage-unavailable' }, 503, {}, apiOptions);
      }
      const summary = ArrivalAlertSummarySchema.parse({
        id,
        routeId: input.data.routeId,
        direction: input.data.direction,
        targetStopId: input.data.targetStopId,
        targetStopIndex: input.data.targetStopIndex,
        threshold: input.data.threshold,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ALERT_EXPIRY_MS).toISOString(),
      });
      await dependencies.stores.alerts.set(alertStorageKey(subscription.id, summary.id), {
        ...summary,
        subscriptionId: subscription.id,
        state: 'pending',
      });
      return jsonResponse(request, summary, 201, {}, apiOptions);
    } catch {
      return jsonResponse(request, { error: 'storage-unavailable' }, 503, {}, apiOptions);
    } finally {
      if (lease) {
        try {
          await releasePushMutationReservation(dependencies.stores.reservations, subscription.id, lease, now);
        } catch {
          // An expired reservation is safe to reclaim on the next request.
        }
      }
    }
  };
}

export default async function pushAlertsDefaultHandler(request: Request, context: Context): Promise<Response> {
  return createPushAlertsHandler()(request, context);
}

export const config: Config = {
  path: ['/api/push/alerts', '/api/push/alerts/:alertId'],
  method: ['GET', 'POST', 'DELETE', 'OPTIONS'],
};
