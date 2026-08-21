import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TransitCatalog } from '../../shared/transit-contract';
import { buildServer } from '../app';
import { REALTIME_RATE_LIMIT_MAX_TRACKED_KEYS } from '../config';
import { DsatClientError } from '../dsat/dsat-client';
import { RealtimeRateLimiter } from './realtime';

const catalogUrl = new URL('../../tests/fixtures/catalog/catalog.json', import.meta.url);
const catalog = JSON.parse(readFileSync(catalogUrl, 'utf8')) as TransitCatalog;

const upstreamPayload = {
  header: '000',
  data: {
    routeInfo: [
      {
        staCode: 'M1',
        busInfo: [{ busPlate: 'SANITIZED-PLATE-001', speed: '9.5', status: '行駛中' }],
      },
    ],
  },
};

async function createApp(options: { environment?: 'development' | 'production'; fetch?: typeof fetch } = {}) {
  const app = buildServer({ catalog, ...options });
  await app.ready();
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('realtime Fastify routes', () => {
  it('expires old rate-limit entries and caps unique client state', () => {
    let now = 1_000;
    const limiter = new RealtimeRateLimiter({
      now: () => now,
      windowMs: 100,
      maxRequests: 1,
      maxTrackedKeys: 3,
    });

    for (let index = 0; index < 10; index += 1) {
      limiter.allow(`client-${index}`);
    }
    expect(limiter.trackedKeyCount).toBeLessThanOrEqual(3);

    now += 101;
    limiter.allow('after-expiry');
    expect(limiter.trackedKeyCount).toBeLessThanOrEqual(3);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5])('falls back safely for invalid maxTrackedKeys=%s', (maxTrackedKeys) => {
    const limiter = new RealtimeRateLimiter({
      now: () => 1_000,
      windowMs: 60_000,
      maxRequests: 1,
      maxTrackedKeys,
    });

    expect(limiter.trackedKeyLimit).toBe(REALTIME_RATE_LIMIT_MAX_TRACKED_KEYS);
  });

  it('reports backend health without touching the upstream', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(upstreamPayload), { status: 200 }));
    const app = await createApp({ fetch: fetcher });

    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({ status: 'ok' });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('accepts an allowlisted route and returns the normalized observation DTO', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(upstreamPayload), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    }));
    const app = await createApp({ fetch: fetcher });

    try {
      const response = await app.inject({ method: 'GET', url: '/api/bus/realtime/1/0' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toMatchObject({
        route: '1',
        direction: 0,
        stale: false,
        source: 'DSAT observation',
        buses: [{ plate: 'SANITIZED-PLATE-001', stationCode: 'M1', speedKph: 9.5 }],
      });
      expect(response.json()).not.toHaveProperty('raw');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));
    } finally {
      await app.close();
    }
  });

  it('accepts direction 1 and rejects a route outside the catalog allowlist', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(upstreamPayload), { status: 200 }));
    const app = await createApp({ fetch: fetcher });

    try {
      const directionOne = await app.inject({ method: 'GET', url: '/api/bus/realtime/1/1' });
      const unknownRoute = await app.inject({ method: 'GET', url: '/api/bus/realtime/not-allowlisted/0' });

      expect(directionOne.statusCode).toBe(200);
      expect(directionOne.json()).toMatchObject({ route: '1', direction: 1 });
      expect(unknownRoute.statusCode).toBe(404);
      expect(unknownRoute.headers['cache-control']).toBe('no-store');
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('returns stale cached data after a failed refresh and structured errors without a cache', async () => {
    let nowMs = 1_000_000;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(upstreamPayload), { status: 200 }))
      .mockRejectedValueOnce(new Error('upstream unavailable'));
    const app = buildServer({ catalog, fetch: fetcher, now: () => new Date(nowMs) });
    await app.ready();

    try {
      const first = await app.inject({ method: 'GET', url: '/api/bus/realtime/1/0' });
      nowMs += 12_001;
      const stale = await app.inject({ method: 'GET', url: '/api/bus/realtime/1/0' });

      expect(first.statusCode).toBe(200);
      expect(stale.statusCode).toBe(200);
      expect(stale.json()).toMatchObject({ stale: true, ageSeconds: 12 });
    } finally {
      await app.close();
    }

    const noCacheApp = buildServer({
      catalog,
      client: {
        fetchRoute: async () => {
          throw new Error('first request failed');
        },
      },
    });
    await noCacheApp.ready();
    try {
      const response = await noCacheApp.inject({ method: 'GET', url: '/api/bus/realtime/1/0' });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual({ error: 'upstream-error' });
    } finally {
      await noCacheApp.close();
    }
  });

  it('maps upstream timeout to 504 and other typed upstream errors to 502', async () => {
    const timeoutApp = buildServer({
      catalog,
      client: {
        fetchRoute: async () => {
          throw new DsatClientError('timeout');
        },
      },
    });
    const otherApp = buildServer({
      catalog,
      client: {
        fetchRoute: async () => {
          throw new DsatClientError('http', { status: 503 });
        },
      },
    });
    await Promise.all([timeoutApp.ready(), otherApp.ready()]);

    try {
      const timeoutResponse = await timeoutApp.inject({ method: 'GET', url: '/api/bus/realtime/1/0' });
      const otherResponse = await otherApp.inject({ method: 'GET', url: '/api/bus/realtime/1/0' });

      expect(timeoutResponse.statusCode).toBe(504);
      expect(timeoutResponse.json()).toEqual({ error: 'upstream-timeout' });
      expect(otherResponse.statusCode).toBe(502);
      expect(otherResponse.json()).toEqual({ error: 'upstream-error' });
    } finally {
      await Promise.all([timeoutApp.close(), otherApp.close()]);
    }
  });

  it('rejects an invalid direction before calling DSAT', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(upstreamPayload), { status: 200 }));
    const app = await createApp({ fetch: fetcher });

    try {
      const response = await app.inject({ method: 'GET', url: '/api/bus/realtime/1/2' });

      expect(response.statusCode).toBe(400);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns 404 for a debug DSAT route when the server runs in production', async () => {
    const app = await createApp({ environment: 'production' });

    try {
      const response = await app.inject({ method: 'GET', url: '/api/debug/dsat/1/0' });

      expect(response.statusCode).toBe(404);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });

  it('does not let NODE_ENV=development override an explicit production config', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const fetcher = vi.fn(async () => new Response(JSON.stringify(upstreamPayload), { status: 200 }));
    const app = await createApp({ environment: 'production', fetch: fetcher });

    try {
      const response = await app.inject({ method: 'GET', url: '/api/debug/dsat/1/0' });

      expect(response.statusCode).toBe(404);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('exposes raw unknown fields only on the development debug route', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ...upstreamPayload,
      unmodeledTopLevel: 'debug-only',
    }), { status: 200 }));
    const app = await createApp({ environment: 'development', fetch: fetcher });

    try {
      const response = await app.inject({ method: 'GET', url: '/api/debug/dsat/1/0' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        buses: [{ plate: '[MASKED]' }],
        raw: { unmodeledTopLevel: 'debug-only' },
      });
    } finally {
      await app.close();
    }
  });

  it.each(['', 'staging', 'preview', 'development-preview', 'typo'])('does not expose debug route for NODE_ENV=%s', async (environment) => {
    if (environment) {
      vi.stubEnv('NODE_ENV', environment);
    } else {
      vi.unstubAllEnvs();
      delete process.env.NODE_ENV;
    }
    const app = await createApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/api/debug/dsat/1/0' });

      expect(response.statusCode).toBe(404);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });

  it('adds no-store to unknown API routes', async () => {
    const app = await createApp({ environment: 'production' });

    try {
      const response = await app.inject({ method: 'GET', url: '/api/not-registered' });

      expect(response.statusCode).toBe(404);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });
});
