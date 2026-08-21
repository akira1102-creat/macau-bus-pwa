import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  UPSTREAM_FILES,
  buildCatalogFromUpstream,
  createProvenance,
  syncStaticData,
} from './sync-static-data';
import type { UpstreamStaticData } from './sync-static-data';

const fixtureRoot = new URL('../tests/fixtures/catalog/', import.meta.url);

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, fixtureRoot), 'utf8')) as unknown;
}

const upstream: UpstreamStaticData = {
  busStops: readFixture('bus-stops.json'),
  operators: readFixture('operators.json'),
  routeMetadata: readFixture('route-metadata.json'),
  routeStops: readFixture('route-stops.json'),
  segmentTimes: readFixture('segment_times.json'),
};

describe('static catalog synchronizer', () => {
  it('normalizes the five upstream files into ordered routes and stops', () => {
    const catalog = buildCatalogFromUpstream(upstream, {
      generatedAt: '2026-08-21T00:00:00.000Z',
      provenance: {
        sourceRepository: 'https://github.com/example/macau-bus-data',
        sourceRef: 'fixture-ref-20260821',
        syncedAt: '2026-08-21T00:00:00.000Z',
        files: [],
      },
    });

    expect(catalog.routes[0]?.directions[0]?.stopIds).toEqual(['M1', 'M2', 'M3']);
    expect(catalog.stops.find((stop) => stop.id === 'M2')?.coordinates).toEqual([113.5411, 22.1911]);
    expect(catalog.segmentTimes[0]?.medianSeconds).toBe(55);
  });

  it('allowlists exactly the five upstream files and records URL/ref/time/SHA-256', () => {
    expect(UPSTREAM_FILES).toEqual([
      'bus-stops.json',
      'operators.json',
      'route-metadata.json',
      'route-stops.json',
      'segment_times.json',
    ]);

    const provenance = createProvenance({
      sourceRepository: 'https://github.com/example/macau-bus-data',
      sourceRef: 'fixture-ref-20260821',
      syncedAt: '2026-08-21T00:00:00.000Z',
      files: UPSTREAM_FILES.map((name, index) => ({
        name,
        url: `https://raw.example.test/fixture-ref-20260821/${name}`,
        ref: 'fixture-ref-20260821',
        syncedAt: '2026-08-21T00:00:00.000Z',
        sha256: String.fromCharCode(97 + index).repeat(64),
      })),
    });

    expect(provenance.files).toHaveLength(5);
    expect(provenance.files.every((file) => /^\w{64}$/.test(file.sha256))).toBe(true);
    expect(provenance.files.every((file) => file.url && file.ref && file.syncedAt)).toBe(true);
  });

  it('syncs only the five allowlisted files and writes hashed provenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'macau-bus-pwa-sync-'));
    const outputDir = join(root, 'public-data');
    const upstreamDir = join(root, 'upstream');
    const payloads: Record<string, unknown> = {
      'bus-stops.json': upstream.busStops,
      'operators.json': upstream.operators,
      'route-metadata.json': upstream.routeMetadata,
      'route-stops.json': upstream.routeStops,
      'segment_times.json': upstream.segmentTimes,
    };
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      const name = url.slice(url.lastIndexOf('/') + 1);
      return new Response(JSON.stringify(payloads[name]), { status: 200 });
    };

    try {
      await syncStaticData({
        ref: 'fixture-ref-20260821',
        syncedAt: '2026-08-21T00:00:00.000Z',
        outputDir,
        upstreamDir,
        fetch: fetcher,
      });

      expect(requests).toHaveLength(UPSTREAM_FILES.length);
      expect(requests.every((url) => url.includes('/fixture-ref-20260821/'))).toBe(true);
      expect(requests.map((url) => url.slice(url.lastIndexOf('/') + 1))).toEqual([...UPSTREAM_FILES]);

      const catalog = JSON.parse(await readFile(join(outputDir, 'catalog.json'), 'utf8')) as { provenance: { files: Array<{ name: string; sha256: string; url: string; ref: string; syncedAt: string }> } };
      const provenance = JSON.parse(await readFile(join(outputDir, 'provenance.json'), 'utf8')) as typeof catalog.provenance;
      expect(provenance.files).toEqual(catalog.provenance.files);
      expect(provenance.files.map((file) => file.name)).toEqual([...UPSTREAM_FILES]);
      expect(provenance.files.every((file) => file.url.includes('raw.githubusercontent.com'))).toBe(true);
      expect(provenance.files.every((file) => file.ref === 'fixture-ref-20260821' && file.syncedAt === '2026-08-21T00:00:00.000Z')).toBe(true);
      expect(provenance.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);

      const expectedHash = createHash('sha256').update(JSON.stringify(payloads['bus-stops.json'])).digest('hex');
      expect(provenance.files[0]?.sha256).toBe(expectedHash);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
