import { describe, expect, it, vi } from 'vitest';

import { getRealtimeRoute } from './api-client';
import type { RealtimeApiError } from './api-client';

describe('browser realtime API client', () => {
  it('requests only the normalized endpoint and strips raw payload fields', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      route: '1',
      direction: 0,
      updatedAt: '2026-08-21T00:00:00.000Z',
      ageSeconds: 0,
      stale: false,
      source: 'DSAT observation',
      buses: [{
        plate: 'SANITIZED-PLATE-001',
        stationCode: 'M1',
        speedKph: 12,
        status: null,
        passengerFlow: null,
        busType: null,
        facilities: null,
        rawVehicle: 'must-not-leak',
      }],
      raw: { secret: 'must-not-leak' },
    }), { status: 200 }));

    const response = await getRealtimeRoute('1', 0, { fetch: fetcher });

    expect(response).not.toHaveProperty('raw');
    expect(response.buses[0]).not.toHaveProperty('rawVehicle');
    expect(fetcher).toHaveBeenCalledWith('/api/bus/realtime/1/0', expect.objectContaining({ method: 'GET' }));
  });

  it('returns a typed error without exposing an error response body', async () => {
    const fetcher = vi.fn(async () => new Response('private upstream detail', { status: 502 }));

    await expect(getRealtimeRoute('1', 0, { fetch: fetcher })).rejects.toMatchObject({
      name: 'RealtimeApiError',
      code: 'http',
      status: 502,
    } satisfies Partial<RealtimeApiError>);
  });
});
