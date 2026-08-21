import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseDsatRouteResponse } from './dsat-parser';

const fixtureUrl = new URL('../../tests/fixtures/dsat/route-response.json', import.meta.url);
const fixture = JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown;

describe('DSAT tolerant parser', () => {
  it('normalizes buses nested under station observations and numeric speed strings', () => {
    const parsed = parseDsatRouteResponse(fixture);

    expect(parsed.applicationHeader).toBe('000');
    expect(parsed.buses).toEqual([
      {
        plate: 'SANITIZED-PLATE-001',
        stationCode: 'M1',
        speedKph: 12.5,
        status: '行駛中',
        passengerFlow: null,
        busType: '普通',
        facilities: '1',
      },
      {
        plate: 'SANITIZED-PLATE-002',
        stationCode: 'M2',
        speedKph: null,
        status: null,
        passengerFlow: null,
        busType: null,
        facilities: null,
      },
    ]);
  });

  it('rejects an HTTP-success payload whose application header is not 000', () => {
    expect(() => parseDsatRouteResponse({ header: '1200', data: { routeInfo: [] } })).toThrow(/header/i);
  });

  it('treats absent route observations and optional fields as empty data', () => {
    const parsed = parseDsatRouteResponse({ header: '000', data: {} });

    expect(parsed.buses).toEqual([]);
  });
});
