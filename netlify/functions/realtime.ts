import type { Config, Context } from '@netlify/functions';

import { getCatalogRepository, isFallbackRouteAllowed } from './_shared/catalog';
import { guardApiRequest, jsonResponse } from './_shared/http';
import { getNetlifyRuntime } from './_shared/runtime';
import { RealtimeRouteResponseSchema, type DirectionId } from '../../shared/transit-contract';
import { DsatClientError } from '../../server/dsat/dsat-client';

function parseDirection(value: string): DirectionId | undefined {
  if (value === '0') return 0;
  if (value === '1') return 1;
  return undefined;
}

function clientKey(context: Context): string {
  return context.ip?.trim() || 'unknown-client';
}

function upstreamError(
  error: unknown,
  requestId?: string,
): { status: number; body: { error: string }; diagnosticCode: string } {
  const diagnosticCode = error instanceof DsatClientError ? error.code : 'unknown';
  console.error(JSON.stringify({
    event: 'dsat-request-failed',
    code: diagnosticCode,
    ...(requestId ? { requestId } : {}),
  }));
  if (error instanceof DsatClientError && error.code === 'timeout') {
    return { status: 504, body: { error: 'upstream-timeout' }, diagnosticCode };
  }
  return { status: 502, body: { error: 'upstream-error' }, diagnosticCode };
}

export default async function realtimeHandler(request: Request, context: Context): Promise<Response> {
  const guarded = guardApiRequest(request);
  if (guarded) {
    return guarded;
  }

  const routeId = context.params?.route?.trim() ?? '';
  const direction = parseDirection(context.params?.direction?.trim() ?? '');
  if (!routeId) {
    return jsonResponse(request, { error: 'invalid-route' }, 400);
  }
  if (direction === undefined) {
    return jsonResponse(request, { error: 'invalid-direction' }, 400);
  }

  const catalog = await getCatalogRepository();
  if (catalog) {
    if (!catalog.getRoute(routeId)) {
      return jsonResponse(request, { error: 'route-not-allowlisted' }, 404);
    }
    if (!catalog.getDirection(routeId, direction)) {
      return jsonResponse(request, { error: 'direction-not-allowlisted' }, 404);
    }
  } else if (!isFallbackRouteAllowed(routeId)) {
    return jsonResponse(request, { error: 'route-not-allowlisted' }, 404);
  }

  const runtime = getNetlifyRuntime();
  if (!runtime.rateLimiter.allow(clientKey(context))) {
    return jsonResponse(request, { error: 'rate-limit-exceeded' }, 429);
  }

  try {
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
    return jsonResponse(request, {
      ...result.value,
      ageSeconds: result.ageSeconds,
      stale: result.stale,
    });
  } catch (error) {
    const mapped = upstreamError(error, context.requestId);
    return jsonResponse(request, mapped.body, mapped.status, {
      'X-Upstream-Error-Code': mapped.diagnosticCode,
    });
  }
}

export const config: Config = {
  path: '/api/bus/realtime/:route/:direction',
  method: ['GET', 'OPTIONS'],
};
