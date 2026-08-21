import { describe, expect, it, vi } from 'vitest';

import {
  DSAT_MAX_RESPONSE_BYTES,
  DSAT_ORIGIN,
  DSAT_REFERER,
  DSAT_TIMEOUT_MS,
  buildDsatProbeRequest,
  fetchDsatProbe,
} from './test-dsat';

describe('DSAT probe request', () => {
  it('uses the current form field order, origin/referer and a fixed known token vector', () => {
    const request = buildDsatProbeRequest({
      route: '1',
      direction: 0,
      now: new Date(2026, 7, 21, 12, 34, 56),
    });

    expect(request.body).toBe(
      'action=dy&routeName=1&dir=0&lang=zh-tw&routeType=0&device=web',
    );
    expect(request.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(DSAT_ORIGIN).toBe('https://bis.dsat.gov.mo:37812');
    expect(request.headers.origin).toBe('https://bis.dsat.gov.mo:37812');
    expect(request.headers.referer).toBe(DSAT_REFERER);
    expect(request.headers.token).toBe('26982026ca6b27e30821d3f6c95ee98f123488a00648');
  });

  it('aborts a hung request through the timeout AbortSignal', async () => {
    vi.useFakeTimers();
    const request = buildDsatProbeRequest({ route: '1', direction: 0 });
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
    );

    try {
      const pending = fetchDsatProbe(request, { fetch: fetcher });
      const rejection = expect(pending).rejects.toThrow(/逾時|timeout/i);
      await vi.advanceTimersByTimeAsync(DSAT_TIMEOUT_MS);
      await rejection;
      expect(fetcher).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
      );
      expect(DSAT_TIMEOUT_MS).toBe(4_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a response once its bounded body exceeds the limit', async () => {
    const request = buildDsatProbeRequest({ route: '1', direction: 0 });
    const fetcher = vi.fn(async () => new Response('0123456789', {
      status: 200,
      headers: { 'content-length': String(DSAT_MAX_RESPONSE_BYTES + 1) },
    }));

    await expect(fetchDsatProbe(request, { fetch: fetcher })).rejects.toThrow(/回應|response|size/i);
    expect(DSAT_MAX_RESPONSE_BYTES).toBeGreaterThan(0);
  });

  it('aborts a hanging response body read under the same timeout', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start() {
        // Keep the stream pending until the probe timeout cancels it.
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = buildDsatProbeRequest({ route: '1', direction: 0 });
    const fetcher = vi.fn(async () => new Response(body, { status: 200 }));

    try {
      const pending = fetchDsatProbe(request, { fetch: fetcher });
      const rejection = expect(pending).rejects.toThrow(/逾時|timeout/i);
      await vi.advanceTimersByTimeAsync(DSAT_TIMEOUT_MS);
      await rejection;
      expect(cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
