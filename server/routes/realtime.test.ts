import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TransitCatalog } from '../../shared/transit-contract';
import { buildServer } from '../app';

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
});

describe('realtime Fastify routes', () => {
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
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));
    } finally {
      await app.close();
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
    } finally {
      await app.close();
    }
  });

  it('exposes raw unknown fields only on the development debug route', async () => {
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
});
