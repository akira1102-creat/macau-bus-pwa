import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import fixture from '../tests/fixtures/catalog/catalog.json';
import type { TransitCatalog } from '../shared/transit-contract';
import { buildServer } from './app';

const catalog = fixture as TransitCatalog;
const openApps: Array<{ close(): Promise<unknown> }> = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('production static integration', () => {
  it('serves the app shell, SPA fallback, hashed assets, and API under one process', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'macau-bus-pwa-static-'));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>test shell</title>');
    await writeFile(join(directory, 'assets.js'), 'console.log("test")');

    const app = buildServer({ environment: 'production', catalog, staticDir: directory });
    openApps.push(app);

    const root = await app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.headers['content-type']).toContain('text/html');
    expect(root.body).toContain('test shell');

    const fallback = await app.inject({ method: 'GET', url: '/routes?tab=routes' });
    expect(fallback.statusCode).toBe(200);
    expect(fallback.body).toContain('test shell');

    const asset = await app.inject({ method: 'GET', url: '/assets.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain('test');

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });
  });
});
