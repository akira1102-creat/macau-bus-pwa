import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import arrivalsHandler from '../../netlify/functions/arrivals';
import { resetNetlifyRuntimeForTests } from '../../netlify/functions/_shared/runtime';

const allowedOrigin = 'https://akira1102-creat.github.io';
const fixturePath = new URL('../fixtures/catalog/catalog.json', import.meta.url);

const upstreamPayload = {
  header: '000',
  data: {
    routeInfo: [
      {
        staCode: 'M1',
        busInfo: [{ busPlate: 'PLATE-001', speed: '9.5', status: '行駛中' }],
      },
      {
        staCode: 'M2',
        busInfo: [{ busPlate: 'PLATE-002', speed: '8.0', status: '行駛中' }],
      },
    ],
  },
};

const envValues = new Map<string, string>();

type ArrivalsContext = Parameters<typeof arrivalsHandler>[1];

function setEnvironment(values: Record<string, string | undefined> = {}): void {
  envValues.clear();
  envValues.set('CATALOG_PATH', fileURLToPath(fixturePath));
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

function stubUpstream(response = upstreamPayload): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

function request(
  body: unknown,
  method = 'POST',
  origin: string | undefined = allowedOrigin,
): Request {
  const headers: Record<string, string> = {};
  if (origin !== undefined) headers.Origin = origin;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  return new Request('https://function.example/api/bus/arrivals', {
    method,
    headers,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
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

describe('POST /api/bus/arrivals', () => {
  it('answers the production CORS preflight without contacting DSAT', async () => {
    const fetcher = stubUpstream();

    const response = await arrivalsHandler(request(undefined, 'OPTIONS'), {} as ArrivalsContext);

    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(await response.text()).toBe('');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('deduplicates stop ids, groups route-direction requests, returns remaining stops, sorts, and strips raw data', async () => {
    const fetcher = stubUpstream();

    const response = await arrivalsHandler(
      request({ stopIds: [' M2 ', 'M1', 'M2'] }),
      {} as ArrivalsContext,
    );
    const body = await response.json() as {
      updatedAt: string;
      arrivals: Array<Record<string, unknown>>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
    expect(body.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(body.arrivals).toEqual([
      { stopId: 'M1', route: '1', direction: 0, plate: 'PLATE-001', remainingStops: 0 },
      { stopId: 'M2', route: '1', direction: 0, plate: 'PLATE-002', remainingStops: 0 },
      { stopId: 'M1', route: '1', direction: 1, plate: 'PLATE-001', remainingStops: 0 },
      { stopId: 'M2', route: '1', direction: 1, plate: 'PLATE-002', remainingStops: 0 },
      { stopId: 'M2', route: '1', direction: 0, plate: 'PLATE-001', remainingStops: 1 },
      { stopId: 'M1', route: '1', direction: 1, plate: 'PLATE-002', remainingStops: 1 },
    ]);
    expect(JSON.stringify(body)).not.toContain('routeInfo');
    expect(JSON.stringify(body)).not.toContain('raw');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed JSON and unsupported methods without contacting DSAT', async () => {
    const fetcher = stubUpstream();

    const malformed = await arrivalsHandler(request('{', 'POST'), {} as ArrivalsContext);
    const method = await arrivalsHandler(request(undefined, 'GET'), {} as ArrivalsContext);

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'invalid-json' });
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('POST, OPTIONS');
    expect(await method.json()).toEqual({ error: 'method-not-allowed' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects more than five stop ids with a safe 413 response', async () => {
    const fetcher = stubUpstream();

    const response = await arrivalsHandler(
      request({ stopIds: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'] }),
      {} as ArrivalsContext,
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'too-many-stops' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns no rows for unknown stops and does not call DSAT', async () => {
    const fetcher = stubUpstream();

    const response = await arrivalsHandler(
      request({ stopIds: ['UNKNOWN'] }),
      {} as ArrivalsContext,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ arrivals: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed when the catalog is unavailable', async () => {
    const fetcher = stubUpstream();
    setEnvironment({ CATALOG_PATH: 'D:\\missing\\catalog.json' });
    resetNetlifyRuntimeForTests();

    const response = await arrivalsHandler(
      request({ stopIds: ['M1'] }),
      {} as ArrivalsContext,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'catalog-unavailable' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects disallowed origins and maps upstream failures to a safe 502 body', async () => {
    const failedFetcher = vi.fn(async () => { throw new Error('private upstream detail'); });
    vi.stubGlobal('fetch', failedFetcher);

    const corsResponse = await arrivalsHandler(
      request({ stopIds: ['M1'] }, 'POST', 'https://attacker.example'),
      {} as ArrivalsContext,
    );
    const upstreamResponse = await arrivalsHandler(
      request({ stopIds: ['M1'] }),
      {} as ArrivalsContext,
    );

    expect(corsResponse.status).toBe(403);
    expect(await corsResponse.json()).toEqual({ error: 'cors-not-allowed' });
    expect(upstreamResponse.status).toBe(502);
    const body = await upstreamResponse.json() as Record<string, unknown>;
    expect(body).toEqual({ error: 'upstream-error' });
    expect(JSON.stringify(body)).not.toContain('private upstream detail');
  });
});
