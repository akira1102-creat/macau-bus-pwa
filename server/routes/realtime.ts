import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { CatalogRepository } from '../../src/data/catalog-repository';
import { RealtimeRouteResponseSchema, type DirectionId, type RealtimeRouteResponse } from '../../shared/transit-contract';
import { REALTIME_RATE_LIMIT_MAX_TRACKED_KEYS } from '../config';
import { DsatClientError, type DsatClient } from '../dsat/dsat-client';
import type { RealtimeCache } from '../cache/realtime-cache';
import { sendCatalogUnavailable } from '../catalog-status';

interface RealtimeParams {
  route: string;
  direction: string;
}

interface RateLimitState {
  windowStartedAt: number;
  count: number;
}

export interface RealtimeRateLimiterOptions {
  now?: () => number;
  windowMs: number;
  maxRequests: number;
  maxTrackedKeys?: number;
}

export class RealtimeRateLimiter {
  private readonly states = new Map<string, RateLimitState>();
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly maxTrackedKeys: number;

  constructor(options: RealtimeRateLimiterOptions) {
    this.now = options.now ?? (() => Date.now());
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
    const requestedMaxTrackedKeys = options.maxTrackedKeys;
    if (
      typeof requestedMaxTrackedKeys === 'number'
      && Number.isFinite(requestedMaxTrackedKeys)
      && Number.isInteger(requestedMaxTrackedKeys)
      && requestedMaxTrackedKeys > 0
    ) {
      this.maxTrackedKeys = requestedMaxTrackedKeys;
    } else {
      this.maxTrackedKeys = REALTIME_RATE_LIMIT_MAX_TRACKED_KEYS;
    }
  }

  get trackedKeyCount(): number {
    return this.states.size;
  }

  get trackedKeyLimit(): number {
    return this.maxTrackedKeys;
  }

  allow(key: string): boolean {
    const currentTime = this.now();
    for (const [stateKey, state] of this.states) {
      if (currentTime - state.windowStartedAt >= this.windowMs) {
        this.states.delete(stateKey);
      }
    }
    const previous = this.states.get(key);
    if (!previous || currentTime - previous.windowStartedAt >= this.windowMs) {
      this.states.delete(key);
      while (this.states.size >= this.maxTrackedKeys) {
        const oldestKey = this.states.keys().next().value as string | undefined;
        if (oldestKey === undefined) {
          break;
        }
        this.states.delete(oldestKey);
      }
      this.states.set(key, { windowStartedAt: currentTime, count: 1 });
      return true;
    }
    if (previous.count >= this.maxRequests) {
      return false;
    }
    previous.count += 1;
    this.states.delete(key);
    this.states.set(key, previous);
    return true;
  }
}

export interface RegisterRealtimeRoutesOptions {
  app: FastifyInstance;
  catalog?: CatalogRepository | undefined;
  catalogReady?: boolean;
  client: DsatClient;
  cache: RealtimeCache<RealtimeRouteResponse>;
  now?: () => Date;
  rateLimiter: RealtimeRateLimiter;
}

function parseDirection(value: string): DirectionId | undefined {
  if (value === '0') {
    return 0;
  }
  if (value === '1') {
    return 1;
  }
  return undefined;
}

function sendError(reply: FastifyReply, statusCode: number, code: string): FastifyReply {
  return reply.code(statusCode).send({ error: code });
}

function upstreamErrorResponse(error: unknown): { statusCode: number; code: string } {
  if (error instanceof DsatClientError && error.code === 'timeout') {
    return { statusCode: 504, code: 'upstream-timeout' };
  }
  return { statusCode: 502, code: 'upstream-error' };
}

export function registerRealtimeRoutes(options: RegisterRealtimeRoutesOptions): void {
  const now = options.now ?? (() => new Date());

  options.app.get<{ Params: RealtimeParams }>(
    '/api/bus/realtime/:route/:direction',
    async (request: FastifyRequest<{ Params: RealtimeParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');
      if (options.catalogReady === false || !options.catalog) {
        return sendCatalogUnavailable(reply);
      }
      if (!options.rateLimiter.allow(request.ip)) {
        return sendError(reply, 429, 'rate-limit-exceeded');
      }

      const routeId = request.params.route.trim();
      const direction = parseDirection(request.params.direction);
      if (direction === undefined) {
        return sendError(reply, 400, 'invalid-direction');
      }
      if (!options.catalog.getRoute(routeId)) {
        return sendError(reply, 404, 'route-not-allowlisted');
      }

      const key = `${routeId}|${direction}`;
      try {
        const result = await options.cache.get(key, async () => {
          const upstream = await options.client.fetchRoute(routeId, direction);
          const fetchedAt = now().toISOString();
          return RealtimeRouteResponseSchema.parse({
            route: routeId,
            direction,
            updatedAt: fetchedAt,
            ageSeconds: 0,
            stale: false,
            source: 'DSAT observation',
            buses: upstream.buses,
          });
        });
        const body: RealtimeRouteResponse = {
          ...result.value,
          ageSeconds: result.ageSeconds,
          stale: result.stale,
        };
        return reply.code(200).send(body);
      } catch (error) {
        const mapped = upstreamErrorResponse(error);
        return sendError(reply, mapped.statusCode, mapped.code);
      }
    },
  );
}
