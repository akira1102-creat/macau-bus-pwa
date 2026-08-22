import { randomBytes } from 'node:crypto';

import type { Config, Context } from '@netlify/functions';

import {
  PushIdentitySchema,
  PushSubscriptionInputSchema,
  StoredSubscriptionSchema,
} from './_shared/push-contract';
import { guardApiRequest, jsonResponse, type ApiRequestOptions } from './_shared/http';
import {
  acquireGlobalSubscriptionAdmission,
  capabilityTokenHash,
  cleanupStaleSubscriptions,
  currentTime,
  DEFAULT_GLOBAL_SUBSCRIPTION_LIMIT,
  DEFAULT_MAX_STALE_CLEANUP,
  getPushRateLimiter,
  getDefaultPushDependencies,
  makeCapabilityToken,
  makeRandomId,
  renewGlobalSubscriptionAdmission,
  releaseGlobalSubscriptionAdmission,
  type StaleSubscriptionCleanupOptions,
  type PushApiDependencies,
  type PushReservationLease,
} from './_shared/push-store';

const SUBSCRIPTIONS_API_OPTIONS: ApiRequestOptions = {
  methods: ['POST'],
};
const SUBSCRIPTIONS_MUTATION_OPTIONS: ApiRequestOptions = {
  methods: ['POST'],
  requireTrustedOrigin: true,
};
const MAX_SUBSCRIPTION_BODY_BYTES = 16 * 1024;

function tooLarge(request: Request): boolean {
  const value = request.headers.get('content-length');
  if (value === null) return false;
  const length = Number.parseInt(value, 10);
  return Number.isFinite(length) && length > MAX_SUBSCRIPTION_BODY_BYTES;
}

export function createPushSubscriptionsHandler(
  dependencies: PushApiDependencies = getDefaultPushDependencies(),
): (request: Request, context: Context) => Promise<Response> {
  return async function pushSubscriptionsHandler(request: Request, context: Context): Promise<Response> {
    const apiOptions = request.method === 'POST' || request.method === 'OPTIONS'
      ? SUBSCRIPTIONS_MUTATION_OPTIONS
      : SUBSCRIPTIONS_API_OPTIONS;
    const guarded = guardApiRequest(request, apiOptions);
    if (guarded) return guarded;
    const rateLimiter = dependencies.rateLimiter ?? getPushRateLimiter();
    const clientKey = `push-subscriptions:${context.ip?.trim() || 'unknown-client'}`;
    if (!rateLimiter.allow(clientKey)) {
      return jsonResponse(request, { error: 'rate-limit-exceeded' }, 429, {}, apiOptions);
    }
    if (tooLarge(request)) {
      return jsonResponse(request, { error: 'request-too-large' }, 413, {}, apiOptions);
    }

    let payload: unknown;
    try {
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_SUBSCRIPTION_BODY_BYTES) {
        return jsonResponse(request, { error: 'request-too-large' }, 413, {}, apiOptions);
      }
      payload = JSON.parse(body) as unknown;
    } catch {
      return jsonResponse(request, { error: 'invalid-json' }, 400, {}, apiOptions);
    }

    const parsed = PushSubscriptionInputSchema.safeParse(payload);
    if (!parsed.success) {
      return jsonResponse(request, { error: 'invalid-subscription' }, 400, {}, apiOptions);
    }

    const current = currentTime(dependencies);
    let admission: PushReservationLease | undefined;
    try {
      const randomizer = dependencies.randomBytes ?? randomBytes;
      admission = await acquireGlobalSubscriptionAdmission(dependencies.stores, current, randomizer);
      if (!admission) {
        return jsonResponse(request, { error: 'subscription-cap-busy' }, 409, {}, apiOptions);
      }
      const cleanupOptions: StaleSubscriptionCleanupOptions = {
        maxRecords: dependencies.maxStaleCleanup ?? DEFAULT_MAX_STALE_CLEANUP,
      };
      if (dependencies.staleSubscriptionMs !== undefined) {
        cleanupOptions.staleAfterMs = dependencies.staleSubscriptionMs;
      }
      await cleanupStaleSubscriptions(dependencies.stores, current, cleanupOptions);
      const subscriptionLimit = Number.isInteger(dependencies.globalSubscriptionLimit)
        && (dependencies.globalSubscriptionLimit ?? 0) > 0
        ? dependencies.globalSubscriptionLimit as number
        : DEFAULT_GLOBAL_SUBSCRIPTION_LIMIT;
      if ((await dependencies.stores.subscriptions.list()).length >= subscriptionLimit) {
        return jsonResponse(request, { error: 'subscription-limit' }, 503, {}, apiOptions);
      }
      const now = current.toISOString();
      let subscriptionId = makeRandomId(randomizer);
      for (let attempt = 0; attempt < 4 && await dependencies.stores.subscriptions.get(subscriptionId); attempt += 1) {
        subscriptionId = makeRandomId(randomizer);
      }
      if (await dependencies.stores.subscriptions.get(subscriptionId)) {
        return jsonResponse(request, { error: 'storage-unavailable' }, 503, {}, apiOptions);
      }
      const alertToken = makeCapabilityToken(randomizer);
      const renewedAdmission = await renewGlobalSubscriptionAdmission(
        dependencies.stores,
        admission,
        currentTime(dependencies),
      );
      if (!renewedAdmission) {
        return jsonResponse(request, { error: 'subscription-cap-busy' }, 409, {}, apiOptions);
      }
      admission = renewedAdmission;
      const stored = StoredSubscriptionSchema.parse({
        id: subscriptionId,
        endpoint: parsed.data.endpoint,
        keys: parsed.data.keys,
        tokenHash: capabilityTokenHash(alertToken),
        createdAt: now,
        updatedAt: now,
      });
      await dependencies.stores.subscriptions.set(subscriptionId, stored);

      const identity = PushIdentitySchema.parse({ subscriptionId, alertToken });
      return jsonResponse(request, identity, 201, {}, apiOptions);
    } catch {
      return jsonResponse(request, { error: 'storage-unavailable' }, 503, {}, apiOptions);
    } finally {
      if (admission) {
        try {
          await releaseGlobalSubscriptionAdmission(dependencies.stores, admission, current);
        } catch {
          // The admission lease expires and is reclaimable if release fails.
        }
      }
    }
  };
}

export default async function pushSubscriptionsDefaultHandler(request: Request, context: Context): Promise<Response> {
  return createPushSubscriptionsHandler()(request, context);
}

export const config: Config = {
  path: '/api/push/subscriptions',
  method: ['POST', 'OPTIONS'],
};
