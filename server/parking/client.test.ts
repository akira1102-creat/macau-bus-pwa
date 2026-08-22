import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createParkingClient, ParkingClientError } from './client';

const realtimeFixture = readFileSync(
  fileURLToPath(new URL('../../tests/fixtures/dsat/parking-realtime-synthetic.html', import.meta.url)),
  'utf8',
);
const detailFixture = readFileSync(
  fileURLToPath(new URL('../../tests/fixtures/dsat/parking-detail-synthetic.html', import.meta.url)),
  'utf8',
);

const endpoint = 'https://m.dsat.gov.mo/carpark.aspx';

function createFetcher(options: { fail?: boolean } = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    if (options.fail) throw new Error('synthetic upstream failure');
    const url = String(input);
    if (url === endpoint) return new Response(realtimeFixture, { status: 200 });
    if (url.endsWith('id=12345') || url.endsWith('id=67890')) {
      return new Response(detailFixture, { status: 200 });
    }
    throw new Error(`unexpected synthetic URL ${url}`);
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DSAT parking client', () => {
  it('fetches the official list, enriches details, and returns a stable non-stale snapshot', async () => {
    const fetcher = createFetcher();
    const client = createParkingClient({ fetch: fetcher, endpoint, now: () => new Date('2026-08-22T02:00:00.000Z') });

    const snapshot = await client.fetchSnapshot();

    expect(snapshot).toMatchObject({
      updatedAt: '2026-08-22T02:00:00.000Z',
      stale: false,
    });
    expect(snapshot.facilities[0]).toMatchObject({
      id: '12345',
      location: '合成路 地下停車場',
      entrance: '入口設於合成路 & 東門',
      latitude: 22.198,
      longitude: 113.551,
    });
    expect(snapshot.facilities).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
    expect(fetcher.mock.calls.every(([, init]) => String(init?.headers && new Headers(init.headers).get('user-agent')).includes('macau-bus-pwa'))).toBe(true);
  });

  it('reuses a successful snapshot within the short cache window', async () => {
    let now = new Date('2026-08-22T02:00:00.000Z');
    const fetcher = createFetcher();
    const client = createParkingClient({
      fetch: fetcher,
      endpoint,
      now: () => now,
      cacheTtlMs: 5_000,
    });

    const first = await client.fetchSnapshot();
    now = new Date(now.getTime() + 4_999);
    const second = await client.fetchSnapshot();

    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('returns the last successful result as stale after a refresh failure', async () => {
    let now = new Date('2026-08-22T02:00:00.000Z');
    const fetcher = createFetcher();
    const client = createParkingClient({
      fetch: fetcher,
      endpoint,
      now: () => now,
      cacheTtlMs: 5_000,
    });

    await client.fetchSnapshot();
    now = new Date(now.getTime() + 6_000);
    fetcher.mockImplementation(async () => { throw new Error('synthetic upstream failure'); });
    const stale = await client.fetchSnapshot();

    expect(stale.stale).toBe(true);
    expect(stale.facilities[0]?.id).toBe('12345');
  });

  it('aborts a hanging official response at the configured timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const client = createParkingClient({ fetch: fetcher, endpoint, timeoutMs: 1_000 });
    const pending = client.fetchSnapshot();
    const rejection = expect(pending).rejects.toBeInstanceOf(ParkingClientError);

    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not convert a caller abort into a stale success when a cache entry exists', async () => {
    let now = new Date('2026-08-22T02:00:00.000Z');
    const fetcher = createFetcher();
    const client = createParkingClient({
      fetch: fetcher,
      endpoint,
      now: () => now,
      cacheTtlMs: 5_000,
    });
    await client.fetchSnapshot();
    now = new Date(now.getTime() + 6_000);
    fetcher.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) throw init.signal.reason;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    });
    const controller = new AbortController();
    const pending = client.fetchSnapshot(controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });
});
