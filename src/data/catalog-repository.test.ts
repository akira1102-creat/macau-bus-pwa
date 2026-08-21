import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createCatalogRepository,
  loadCatalog,
} from './catalog-repository';
import type { TransitCatalog } from '../../shared/transit-contract';

const fixtureUrl = new URL('../../tests/fixtures/catalog/catalog.json', import.meta.url);
const fixture = JSON.parse(readFileSync(fixtureUrl, 'utf8')) as TransitCatalog;

function stubCatalogFetch(payload: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('catalog repository', () => {
  it('looks up an allowlisted route by id', async () => {
    stubCatalogFetch(fixture);

    const catalog = await loadCatalog('https://example.test/catalog.json');
    const repository = createCatalogRepository(catalog);

    expect(repository.getRoute('1')?.displayName).toBe('測試線');
    expect(repository.getRoute('999')).toBeUndefined();
  });

  it('returns direction stations in the catalog-defined order', async () => {
    stubCatalogFetch(fixture);

    const repository = createCatalogRepository(await loadCatalog('https://example.test/catalog.json'));

    expect(repository.getDirectionStops('1', 0).map((stop) => stop.id)).toEqual(['M1', 'M2', 'M3']);
    expect(repository.getDirectionStops('1', 1).map((stop) => stop.id)).toEqual(['M3', 'M2', 'M1']);
  });

  it('searches station ids and localized names case-insensitively', async () => {
    stubCatalogFetch(fixture);

    const repository = createCatalogRepository(await loadCatalog('https://example.test/catalog.json'));

    expect(repository.searchStops('中央').map((stop) => stop.id)).toEqual(['M2']);
    expect(repository.searchStops('central').map((stop) => stop.id)).toEqual(['M2']);
  });

  it('rejects a catalog with incomplete provenance metadata', async () => {
    const invalid = structuredClone(fixture) as TransitCatalog;
    delete (invalid.provenance.files[0] as unknown as Record<string, unknown>).sha256;
    stubCatalogFetch(invalid);

    await expect(loadCatalog('https://example.test/catalog.json')).rejects.toThrow(/provenance/i);
  });

  it('rejects coordinates outside the geographic range', async () => {
    const invalid = structuredClone(fixture) as TransitCatalog;
    invalid.stops[0]!.coordinates = [181, 22.19];
    stubCatalogFetch(invalid);

    await expect(loadCatalog('https://example.test/catalog.json')).rejects.toThrow(/coordinate/i);
  });
});
