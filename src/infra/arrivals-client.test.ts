import { afterEach, describe, expect, it, vi } from 'vitest';

import { createArrivalsClient, type ArrivalsApiError } from './arrivals-client';

const updatedAt = '2026-08-22T00:00:00.000Z';

function arrivalsResponse(arrivals: unknown[] = []) {
  return new Response(JSON.stringify({ updatedAt, arrivals }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('browser arrivals API client', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('trims and deduplicates stop IDs before sending a five-stop batch', async () => {
    const fetcher = vi.fn(async () => arrivalsResponse());
    const client = createArrivalsClient({ fetch: fetcher });

    await client.getForStops([' M1 ', 'M1', 'M2', 'M3', 'M4', 'M5']);

    expect(fetcher).toHaveBeenCalledWith('/api/bus/arrivals', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ stopIds: ['M1', 'M2', 'M3', 'M4', 'M5'] }),
    }));
  });

  it('uses the configured API origin and rejects a batch with more than five unique IDs', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/');
    const fetcher = vi.fn(async () => arrivalsResponse());
    const client = createArrivalsClient({ fetch: fetcher });

    await expect(client.getForStops(['M1', 'M2', 'M3', 'M4', 'M5', 'M6'])).rejects.toMatchObject({
      name: 'ArrivalsApiError',
      code: 'invalid-request',
    } satisfies Partial<ArrivalsApiError>);
    expect(fetcher).not.toHaveBeenCalled();

    await client.getForStops(['M1']);
    expect(fetcher).toHaveBeenCalledWith('https://api.example.test/api/bus/arrivals', expect.any(Object));
  });

  it('validates and normalizes the response without leaking unknown fields', async () => {
    const fetcher = vi.fn(async () => arrivalsResponse([{
      stopId: 'M1',
      route: '1',
      direction: 0,
      plate: 'SANITIZED-PLATE-001',
      remainingStops: 2,
      raw: { secret: 'must-not-leak' },
    }]));
    const client = createArrivalsClient({ fetch: fetcher });

    const response = await client.getForStops(['M1']);

    expect(response).toEqual({
      updatedAt,
      arrivals: [{
        stopId: 'M1',
        route: '1',
        direction: 0,
        plate: 'SANITIZED-PLATE-001',
        remainingStops: 2,
      }],
    });
    expect(response.arrivals[0]).not.toHaveProperty('raw');
  });

  it('returns safe typed errors for invalid responses and HTTP failures', async () => {
    const invalidResponse = vi.fn(async () => new Response(JSON.stringify({ updatedAt, arrivals: [{ stopId: 'M1' }] }), { status: 200 }));
    const client = createArrivalsClient({ fetch: invalidResponse });
    await expect(client.getForStops(['M1'])).rejects.toMatchObject({
      name: 'ArrivalsApiError',
      code: 'invalid-response',
    } satisfies Partial<ArrivalsApiError>);

    const httpFailure = vi.fn(async () => new Response('private upstream detail', { status: 502 }));
    const failingClient = createArrivalsClient({ fetch: httpFailure });
    await expect(failingClient.getForStops(['M1'])).rejects.toMatchObject({
      name: 'ArrivalsApiError',
      code: 'http',
      status: 502,
    } satisfies Partial<ArrivalsApiError>);
  });

  it('passes the cancellation signal to fetch and reports cancellation separately', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      await new Promise<void>((resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
          return;
        }
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
        void resolve;
      });
      return arrivalsResponse();
    });
    const client = createArrivalsClient({ fetch: fetcher });
    const controller = new AbortController();
    const request = client.getForStops(['M1'], controller.signal);

    expect(fetcher).toHaveBeenCalledWith('/api/bus/arrivals', expect.objectContaining({ signal: controller.signal }));
    controller.abort();
    await expect(request).rejects.toMatchObject({
      name: 'ArrivalsApiError',
      code: 'aborted',
    } satisfies Partial<ArrivalsApiError>);
  });
});
