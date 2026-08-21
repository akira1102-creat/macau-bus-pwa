import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from './app';

const openApps: Array<{ close(): Promise<unknown> }> = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('catalog availability during server startup', () => {
  it('starts with a static shell and structured sync responses when the catalog file is missing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'macau-bus-pwa-missing-catalog-'));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>offline shell</title>');
    const app = buildServer({
      environment: 'production',
      catalogPath: join(directory, 'renamed-catalog.json'),
      staticDir: directory,
    });
    openApps.push(app);

    const root = await app.inject({ method: 'GET', url: '/' });
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    const realtime = await app.inject({ method: 'GET', url: '/api/bus/realtime/1/0' });

    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('offline shell');
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok', catalogReady: false });
    expect(realtime.statusCode).toBe(503);
    expect(realtime.headers['cache-control']).toBe('no-store');
    expect(realtime.json()).toEqual({
      error: 'catalog-unavailable',
      action: 'data:sync',
      message: 'Catalog data is unavailable. Run npm run data:sync.',
    });
  });

  it('returns the same structured response from the development debug endpoint', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const app = buildServer({
      environment: 'development',
      catalogPath: join(tmpdir(), 'macau-bus-pwa-missing-debug-catalog.json'),
    });
    openApps.push(app);

    const debug = await app.inject({ method: 'GET', url: '/api/debug/dsat/1/0' });

    expect(debug.statusCode).toBe(503);
    expect(debug.headers['cache-control']).toBe('no-store');
    expect(debug.json()).toEqual({
      error: 'catalog-unavailable',
      action: 'data:sync',
      message: 'Catalog data is unavailable. Run npm run data:sync.',
    });
  });
});
