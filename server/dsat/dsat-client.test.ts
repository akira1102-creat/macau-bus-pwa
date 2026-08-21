import { describe, expect, it, vi } from 'vitest';

import { createDsatClient, type DsatClientError } from './dsat-client';
import { DSAT_MAX_RESPONSE_BYTES, DSAT_TIMEOUT_MS } from '../config';

const validPayload = {
  header: '000',
  data: { routeInfo: [] },
};

async function expectClientError(task: Promise<unknown>, code: DsatClientError['code']): Promise<void> {
  await expect(task).rejects.toMatchObject({ code });
}

describe('DSAT client', () => {
  it('aborts a fetch that exceeds the configured timeout without retrying', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));

    try {
      const client = createDsatClient({ fetch: fetcher, timeoutMs: DSAT_TIMEOUT_MS });
      const pending = client.fetchRoute('1', 0);
      const rejection = expectClientError(pending, 'timeout');
      await vi.advanceTimersByTimeAsync(DSAT_TIMEOUT_MS);
      await rejection;
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a response body that hangs after HTTP headers arrive', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const fetcher = vi.fn(async () => new Response(body, { status: 200 }));

    try {
      const client = createDsatClient({ fetch: fetcher, timeoutMs: DSAT_TIMEOUT_MS });
      const pending = client.fetchRoute('1', 0);
      const rejection = expectClientError(pending, 'timeout');
      await vi.advanceTimersByTimeAsync(DSAT_TIMEOUT_MS);
      await rejection;
      expect(cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a response larger than the configured byte limit', async () => {
    const fetcher = vi.fn(async () => new Response('0123456789', {
      status: 200,
      headers: { 'content-length': String(DSAT_MAX_RESPONSE_BYTES + 1) },
    }));
    const client = createDsatClient({ fetch: fetcher });

    await expectClientError(client.fetchRoute('1', 0), 'response-too-large');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects HTTP-success responses with a non-000 application header', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ header: '1200', data: { routeInfo: [] } }), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    }));
    const client = createDsatClient({ fetch: fetcher });

    await expectClientError(client.fetchRoute('1', 0), 'application-header');
  });

  it('parses JSON text even when DSAT labels the response as HTML', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(validPayload), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    }));
    const client = createDsatClient({ fetch: fetcher });

    await expect(client.fetchRoute('1', 0)).resolves.toMatchObject({
      applicationHeader: '000',
      buses: [],
      raw: validPayload,
    });
  });
});
