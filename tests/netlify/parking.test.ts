import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import parkingHandler from '../../netlify/functions/parking';
import { resetParkingRuntimeForTests } from '../../server/parking/runtime';

const allowedOrigin = 'https://akira1102-creat.github.io';
const realtimeFixture = readFileSync(
  fileURLToPath(new URL('../fixtures/dsat/parking-realtime-synthetic.html', import.meta.url)),
  'utf8',
);
const detailFixture = readFileSync(
  fileURLToPath(new URL('../fixtures/dsat/parking-detail-synthetic.html', import.meta.url)),
  'utf8',
);

type ParkingContext = Parameters<typeof parkingHandler>[1];

function request(method = 'GET', origin: string | undefined = allowedOrigin): Request {
  const headers: Record<string, string> = {};
  if (origin !== undefined) headers.Origin = origin;
  return new Request('https://function.example/api/parking', { method, headers });
}

function stubUpstream(): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/carpark.aspx')) return new Response(realtimeFixture, { status: 200 });
    if (url.includes('/carpark_detail.aspx?id=')) return new Response(detailFixture, { status: 200 });
    throw new Error(`unexpected synthetic request ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

beforeEach(() => {
  resetParkingRuntimeForTests();
});

afterEach(() => {
  resetParkingRuntimeForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Netlify GET /api/parking', () => {
  it('returns schema-shaped facilities with exact production CORS and no-store', async () => {
    const fetcher = stubUpstream();

    const response = await parkingHandler(request(), {} as ParkingContext);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
    expect(body.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(body.stale).toBe(false);
    expect(Array.isArray(body.facilities)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('<html');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('answers OPTIONS without contacting the official source and rejects unsupported methods/origins', async () => {
    const fetcher = stubUpstream();

    const preflight = await parkingHandler(request('OPTIONS'), {} as ParkingContext);
    const method = await parkingHandler(request('POST'), {} as ParkingContext);
    const cors = await parkingHandler(request('GET', 'https://attacker.example'), {} as ParkingContext);

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
    expect(await preflight.text()).toBe('');
    expect(method.status).toBe(405);
    expect(await method.json()).toEqual({ error: 'method-not-allowed' });
    expect(cors.status).toBe(403);
    expect(await cors.json()).toEqual({ error: 'cors-not-allowed' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('serves a stale snapshot during the refresh cooldown without another DSAT refresh', async () => {
    const fetcher = stubUpstream();

    const first = await parkingHandler(request(), {} as ParkingContext);
    const second = await parkingHandler(request(), {} as ParkingContext);
    const body = await second.json() as { stale: boolean };

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(body.stale).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('maps an upstream failure to a safe 502 without leaking HTML or error details', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetcher = vi.fn(async () => { throw new Error('<html>private synthetic upstream error</html>'); });
    vi.stubGlobal('fetch', fetcher);

    const response = await parkingHandler(request(), {} as ParkingContext);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: 'upstream-error' });
    expect(JSON.stringify(body)).not.toContain('private synthetic upstream error');
    expect(JSON.stringify(body)).not.toContain('<html');
    expect(logSpy).toHaveBeenCalledWith('{"event":"dsat-parking-failed","code":"network"}');
  });
});
