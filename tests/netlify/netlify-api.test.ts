import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import healthHandler from '../../netlify/functions/health';
import realtimeHandler from '../../netlify/functions/realtime';
import { resetNetlifyRuntimeForTests } from '../../netlify/functions/_shared/runtime';
import { DsatClientError } from '../../server/dsat/dsat-client';

const fixturePath = fileURLToPath(new URL('../fixtures/catalog/catalog.json', import.meta.url));
const netlifyConfigPath = fileURLToPath(new URL('../../netlify.toml', import.meta.url));
const allowedOrigin = 'https://akira1102-creat.github.io';

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

const envValues = new Map<string, string>();

type HealthContext = Parameters<typeof healthHandler>[1];
type RealtimeContext = Parameters<typeof realtimeHandler>[1];

function setEnvironment(values: Record<string, string | undefined> = {}): void {
  envValues.clear();
  envValues.set('ALLOWED_ORIGIN', allowedOrigin);
  envValues.set('CATALOG_PATH', fixturePath);
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      envValues.delete(key);
    } else {
      envValues.set(key, value);
    }
  }
  vi.stubGlobal('Netlify', {
    env: {
      get: (key: string) => envValues.get(key),
    },
  });
}

function stubUpstream(response = upstreamPayload) {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

function healthRequest(method = 'GET', origin = allowedOrigin): Request {
  return new Request('https://function.example/api/health', {
    method,
    ...(origin === undefined ? {} : { headers: { Origin: origin } }),
  });
}

function realtimeRequest(
  route: string,
  direction: string,
  method = 'GET',
  origin = allowedOrigin,
  forwardedFor?: string,
): [Request, RealtimeContext] {
  const headers: Record<string, string> = {};
  if (origin !== undefined) headers.Origin = origin;
  if (forwardedFor !== undefined) headers['X-Forwarded-For'] = forwardedFor;
  const request = new Request(`https://function.example/api/bus/realtime/${route}/${direction}`, {
    method,
    headers,
  });
  const context = {
    params: { route, direction },
  } as unknown as RealtimeContext;
  return [request, context];
}

beforeEach(() => {
  setEnvironment();
  resetNetlifyRuntimeForTests();
});

afterEach(() => {
  resetNetlifyRuntimeForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Netlify production routing', () => {
  it('does not shadow function-declared API paths with disabled default endpoints', () => {
    const config = readFileSync(netlifyConfigPath, 'utf8');

    expect(config).not.toContain('/.netlify/functions/parking');
    expect(config).not.toContain('/.netlify/functions/push-parking-alerts');
  });
});

describe('Netlify health function', () => {
  it('reports catalog readiness, no-store, and CORS for the configured origin', async () => {
    const fetcher = stubUpstream();

    const response = await healthHandler(healthRequest(), {} as HealthContext);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
    expect(await response.json()).toEqual({ status: 'ok', catalogReady: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('answers an allowed CORS preflight without contacting upstream', async () => {
    const fetcher = stubUpstream();

    const response = await healthHandler(healthRequest('OPTIONS'), {} as HealthContext);

    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
    expect(response.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
    expect(await response.text()).toBe('');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects disallowed origins and unsupported methods', async () => {
    const fetcher = stubUpstream();

    const corsResponse = await healthHandler(healthRequest('GET', 'https://attacker.example'), {} as HealthContext);
    const methodResponse = await healthHandler(healthRequest('POST'), {} as HealthContext);

    expect(corsResponse.status).toBe(403);
    expect(await corsResponse.json()).toEqual({ error: 'cors-not-allowed' });
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get('allow')).toBe('GET, OPTIONS');
    expect(await methodResponse.json()).toEqual({ error: 'method-not-allowed' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('cannot widen production CORS through a runtime environment override', async () => {
    const fetcher = stubUpstream();
    setEnvironment({ ALLOWED_ORIGIN: 'https://attacker.example' });

    const response = await healthHandler(
      healthRequest('GET', 'https://attacker.example'),
      {} as HealthContext,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Netlify realtime function', () => {
  it('returns the normalized DSAT observation for an allowlisted route', async () => {
    const fetcher = stubUpstream();
    const [request, context] = realtimeRequest('1', '0');

    const response = await realtimeHandler(request, context);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
    expect(body).toMatchObject({
      route: '1',
      direction: 0,
      stale: false,
      source: 'DSAT observation',
      buses: [{ plate: 'SANITIZED-PLATE-001', stationCode: 'M1', speedKph: 9.5 }],
    });
    expect(body).not.toHaveProperty('raw');
    expect(JSON.stringify(body)).toContain('SANITIZED-PLATE-001');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
  });

  it('validates direction and route before calling DSAT', async () => {
    const fetcher = stubUpstream();

    const [invalidDirectionRequest, invalidDirectionContext] = realtimeRequest('1', '2');
    const invalidDirection = await realtimeHandler(invalidDirectionRequest, invalidDirectionContext);
    const [unknownRouteRequest, unknownRouteContext] = realtimeRequest('not-allowlisted', '0');
    const unknownRoute = await realtimeHandler(unknownRouteRequest, unknownRouteContext);

    expect(invalidDirection.status).toBe(400);
    expect(await invalidDirection.json()).toEqual({ error: 'invalid-direction' });
    expect(unknownRoute.status).toBe(404);
    expect(await unknownRoute.json()).toEqual({ error: 'route-not-allowlisted' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps timeout and other upstream failures to safe error bodies', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const timeoutFetcher = vi.fn(async () => { throw new DsatClientError('timeout'); });
    vi.stubGlobal('fetch', timeoutFetcher);
    resetNetlifyRuntimeForTests();
    const [timeoutRequest, timeoutContext] = realtimeRequest('1', '0');
    const timeoutResponse = await realtimeHandler(timeoutRequest, timeoutContext);

    const errorFetcher = vi.fn(async () => { throw new Error('upstream unavailable'); });
    vi.stubGlobal('fetch', errorFetcher);
    resetNetlifyRuntimeForTests();
    const [errorRequest, errorContext] = realtimeRequest('1', '0');
    const errorResponse = await realtimeHandler(errorRequest, errorContext);

    expect(timeoutResponse.status).toBe(504);
    expect(timeoutResponse.headers.get('x-upstream-error-code')).toBe('timeout');
    expect(await timeoutResponse.json()).toEqual({ error: 'upstream-timeout' });
    expect(errorResponse.status).toBe(502);
    expect(errorResponse.headers.get('x-upstream-error-code')).toBe('network');
    const errorBody = await errorResponse.json();
    expect(errorBody).toEqual({ error: 'upstream-error' });
    expect(JSON.stringify(errorBody)).not.toContain('upstream unavailable');
    expect(logSpy.mock.calls).toEqual([
      ['{"event":"dsat-request-failed","code":"timeout"}'],
      ['{"event":"dsat-request-failed","code":"network"}'],
    ]);
  });

  it('does not trust caller-controlled forwarded addresses for rate-limit identity', async () => {
    stubUpstream();
    let response: Response | undefined;
    for (let index = 0; index <= 60; index += 1) {
      const [request, context] = realtimeRequest('1', '0', 'GET', allowedOrigin, `203.0.113.${index}`);
      response = await realtimeHandler(request, context);
    }

    expect(response?.status).toBe(429);
    expect(await response?.json()).toEqual({ error: 'rate-limit-exceeded' });
  });

  it('keeps unknown routes blocked when no catalog is available', async () => {
    const fetcher = stubUpstream();
    setEnvironment({ CATALOG_PATH: 'D:\\missing\\approved-catalog.json' });
    resetNetlifyRuntimeForTests();

    const health = await healthHandler(healthRequest(), {} as HealthContext);
    const [request, context] = realtimeRequest('not-allowlisted', '0');
    const realtime = await realtimeHandler(request, context);

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', catalogReady: false });
    expect(realtime.status).toBe(404);
    expect(await realtime.json()).toEqual({ error: 'route-not-allowlisted' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed for an unknown production route when catalog is unavailable', async () => {
    const fetcher = stubUpstream();
    setEnvironment({ CATALOG_PATH: 'D:\\missing\\approved-catalog.json' });
    resetNetlifyRuntimeForTests();

    const [request, context] = realtimeRequest('999', '0');
    const response = await realtimeHandler(request, context);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'route-not-allowlisted' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the built-in exact production route list when catalog is unavailable', async () => {
    const fetcher = stubUpstream();
    setEnvironment({ CATALOG_PATH: 'D:\\missing\\approved-catalog.json' });
    resetNetlifyRuntimeForTests();

    const [request, context] = realtimeRequest('1', '0');
    const response = await realtimeHandler(request, context);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ route: '1', direction: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses an exact configured route allowlist when catalog is absent', async () => {
    const fetcher = stubUpstream();
    setEnvironment({
      CATALOG_PATH: 'D:\\missing\\approved-catalog.json',
      ALLOWED_ROUTES: '1, 26A',
    });
    resetNetlifyRuntimeForTests();

    const [request, context] = realtimeRequest('1', '0');
    const response = await realtimeHandler(request, context);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ route: '1', direction: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('can load a configured public catalog without bundling catalog source data', async () => {
    const catalogText = readFileSync(fixturePath, 'utf8');
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      if (String(input) === 'https://catalog.example.test/catalog.json') {
        return new Response(catalogText, { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify(upstreamPayload), { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);
    setEnvironment({ CATALOG_PATH: undefined, CATALOG_URL: 'https://catalog.example.test/catalog.json' });
    resetNetlifyRuntimeForTests();

    const [request, context] = realtimeRequest('1', '0');
    const response = await realtimeHandler(request, context);

    expect(response.status).toBe(200);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://catalog.example.test/catalog.json');
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
