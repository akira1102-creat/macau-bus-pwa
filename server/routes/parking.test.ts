import { afterEach, describe, expect, it, vi } from 'vitest';

import { ParkingClientError, type ParkingClient } from '../parking/client';
import { buildServer } from '../app';

const allowedOrigin = 'https://akira1102-creat.github.io';
const snapshot = {
  updatedAt: '2026-08-22T02:00:00.000Z',
  stale: false,
  facilities: [{
    id: '12345',
    name: '合成停車場',
    location: '合成路',
    entrance: '入口設於合成路',
    latitude: 22.198,
    longitude: 113.551,
    spaces: {
      car: 12,
      motorcycle: 34,
      electricCar: 2,
      electricMotorcycle: 4,
      accessible: 3,
    },
    updatedAt: '2026-08-22T10:00:01+08:00',
    suspended: false,
  }],
};

async function createApp(client: ParkingClient) {
  const app = buildServer({ parkingClient: client });
  await app.ready();
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/parking on Fastify', () => {
  it('returns the schema-validated snapshot with exact CORS and no-store', async () => {
    const client: ParkingClient = { fetchSnapshot: vi.fn(async () => snapshot) };
    const app = await createApp(client);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/parking',
        headers: { origin: allowedOrigin },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['access-control-allow-origin']).toBe(allowedOrigin);
      expect(response.headers.vary).toBe('Origin');
      expect(response.json()).toEqual(snapshot);
      expect(response.body).not.toContain('<html');
    } finally {
      await app.close();
    }
  });

  it('answers GET/OPTIONS with the allowed methods without contacting upstream for preflight', async () => {
    const fetchSnapshot = vi.fn(async () => snapshot);
    const app = await createApp({ fetchSnapshot });

    try {
      const preflight = await app.inject({
        method: 'OPTIONS',
        url: '/api/parking',
        headers: { origin: allowedOrigin },
      });
      const method = await app.inject({ method: 'POST', url: '/api/parking' });

      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers['cache-control']).toBe('no-store');
      expect(preflight.headers['access-control-allow-methods']).toBe('GET, OPTIONS');
      expect(preflight.body).toBe('');
      expect(method.statusCode).toBe(405);
      expect(method.json()).toEqual({ error: 'method-not-allowed' });
      expect(fetchSnapshot).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects an untrusted origin before fetching and returns stale snapshots unchanged', async () => {
    const fetchSnapshot = vi.fn(async () => ({ ...snapshot, stale: true }));
    const app = await createApp({ fetchSnapshot });

    try {
      const cors = await app.inject({
        method: 'GET',
        url: '/api/parking',
        headers: { origin: 'https://attacker.example' },
      });
      const stale = await app.inject({ method: 'GET', url: '/api/parking' });

      expect(cors.statusCode).toBe(403);
      expect(cors.json()).toEqual({ error: 'cors-not-allowed' });
      expect(stale.statusCode).toBe(200);
      expect(stale.json()).toMatchObject({ stale: true, facilities: snapshot.facilities });
      expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('maps timeout and unknown upstream failures to safe responses without raw leakage', async () => {
    const timeoutApp = await createApp({
      fetchSnapshot: async () => { throw new ParkingClientError('timeout'); },
    });
    const errorApp = await createApp({
      fetchSnapshot: async () => { throw new Error('<html>private synthetic upstream error</html>'); },
    });

    try {
      const timeout = await timeoutApp.inject({ method: 'GET', url: '/api/parking' });
      const error = await errorApp.inject({ method: 'GET', url: '/api/parking' });

      expect(timeout.statusCode).toBe(504);
      expect(timeout.json()).toEqual({ error: 'upstream-timeout' });
      expect(error.statusCode).toBe(502);
      expect(error.json()).toEqual({ error: 'upstream-error' });
      expect(error.body).not.toContain('private synthetic upstream error');
    } finally {
      await Promise.all([timeoutApp.close(), errorApp.close()]);
    }
  });
});
