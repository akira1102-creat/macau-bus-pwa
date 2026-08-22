import type { RealtimeRouteResponse } from '../../../shared/transit-contract';
import { RealtimeCache } from '../../../server/cache/realtime-cache';
import { createDsatClient, type DsatClient, type DsatClientOptions } from '../../../server/dsat/dsat-client';
import { REALTIME_FRESH_TTL_MS, REALTIME_RATE_LIMIT_MAX_REQUESTS, REALTIME_RATE_LIMIT_WINDOW_MS } from '../../../server/config';
import { RealtimeRateLimiter } from '../../../server/routes/realtime';
import { readNetlifyEnv } from './env';
import { resetCatalogCacheForTests } from './catalog';

export interface NetlifyRuntime {
  client: DsatClient;
  cache: RealtimeCache<RealtimeRouteResponse>;
  rateLimiter: RealtimeRateLimiter;
}

let runtimeState: NetlifyRuntime | undefined;

function positiveIntegerEnv(name: string): number | undefined {
  const value = readNetlifyEnv(name);
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function createClient(): DsatClient {
  const options: DsatClientOptions = {};
  const endpoint = readNetlifyEnv('DSAT_ENDPOINT');
  const origin = readNetlifyEnv('DSAT_ORIGIN');
  const referer = readNetlifyEnv('DSAT_REFERER');
  const timeoutMs = positiveIntegerEnv('DSAT_TIMEOUT_MS');
  const maxResponseBytes = positiveIntegerEnv('DSAT_MAX_RESPONSE_BYTES');
  if (endpoint !== undefined) options.endpoint = endpoint;
  if (origin !== undefined) options.origin = origin;
  if (referer !== undefined) options.referer = referer;
  if (timeoutMs !== undefined) options.timeoutMs = timeoutMs;
  if (maxResponseBytes !== undefined) options.maxResponseBytes = maxResponseBytes;
  return createDsatClient(options);
}

export function getNetlifyRuntime(): NetlifyRuntime {
  if (!runtimeState) {
    runtimeState = {
      client: createClient(),
      cache: new RealtimeCache<RealtimeRouteResponse>({ freshTtlMs: REALTIME_FRESH_TTL_MS }),
      rateLimiter: new RealtimeRateLimiter({
        windowMs: REALTIME_RATE_LIMIT_WINDOW_MS,
        maxRequests: REALTIME_RATE_LIMIT_MAX_REQUESTS,
      }),
    };
  }
  return runtimeState;
}

export function resetNetlifyRuntimeForTests(): void {
  runtimeState = undefined;
  resetCatalogCacheForTests();
}
