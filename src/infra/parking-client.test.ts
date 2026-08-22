import { describe, expect, it, vi } from 'vitest';

import { createParkingApiClient } from './parking-client';
import type { ParkingApiError } from './parking-client';

const snapshot = {
  updatedAt: '2026-08-22T10:00:00+08:00',
  stale: false,
  facilities: [{
    id: '42',
    name: '測試停車場',
    location: '澳門半島',
    entrance: '東入口',
    latitude: 22.198,
    longitude: 113.543,
    spaces: { car: 12, motorcycle: 4, electricCar: null, electricMotorcycle: null, accessible: 1 },
    updatedAt: '2026-08-22T10:00:00+08:00',
    suspended: false,
  }],
};

describe('ParkingApiClient', () => {
  it('fetches and validates the public parking snapshot without exposing extra fields', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...snapshot, raw: '<html>secret</html>' }), { status: 200 }));
    const client = createParkingApiClient({ fetch: fetcher });

    await expect(client.getSnapshot()).resolves.toEqual(snapshot);
    expect(fetcher).toHaveBeenCalledWith('/api/parking', expect.objectContaining({ method: 'GET', headers: { Accept: 'application/json' } }));
  });

  it('maps aborts and malformed payloads to explicit client errors', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortClient = createParkingApiClient({ fetch: vi.fn() });
    await expect(abortClient.getSnapshot(controller.signal)).rejects.toMatchObject({ code: 'aborted' } satisfies Partial<ParkingApiError>);

    const malformedClient = createParkingApiClient({
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ updatedAt: 'not-a-date', stale: false, facilities: [] }), { status: 200 })),
    });
    await expect(malformedClient.getSnapshot()).rejects.toMatchObject({ code: 'invalid-response' } satisfies Partial<ParkingApiError>);
  });
});
