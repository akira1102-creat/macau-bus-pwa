import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { RealtimeRouteResponse, TransitCatalog } from '../../shared/transit-contract';
import { estimateEtaMinutes } from './eta';

const catalogUrl = new URL('../../tests/fixtures/catalog/catalog.json', import.meta.url);
const fixture = JSON.parse(readFileSync(catalogUrl, 'utf8')) as TransitCatalog;

function catalogWithSegments(segments: TransitCatalog['segmentTimes']): TransitCatalog {
  return {
    ...fixture,
    segmentTimes: segments,
  };
}

function observation(stationCode: string): RealtimeRouteResponse {
  return {
    route: '1',
    direction: 0,
    updatedAt: '2026-08-21T00:00:00.000Z',
    ageSeconds: 0,
    stale: false,
    source: 'DSAT observation',
    buses: [
      {
        plate: 'SANITIZED-PLATE-001',
        stationCode,
        speedKph: 10,
        status: '行駛中',
        passengerFlow: null,
        busType: null,
        facilities: null,
      },
    ],
  };
}

describe('estimateEtaMinutes', () => {
  it('prefers median seconds over average seconds', () => {
    const catalog = catalogWithSegments([
      {
        route: '1',
        direction: 0,
        fromStopId: 'M1',
        toStopId: 'M2',
        medianSeconds: 55,
        averageSeconds: 600,
      },
      {
        route: '1',
        direction: 0,
        fromStopId: 'M2',
        toStopId: 'M3',
        medianSeconds: 65,
        averageSeconds: 600,
      },
    ]);

    expect(estimateEtaMinutes(catalog, observation('M1'), 'M3')).toBe(2);
  });

  it('falls back to average seconds when median is absent', () => {
    const catalog = catalogWithSegments([
      {
        route: '1',
        direction: 0,
        fromStopId: 'M1',
        toStopId: 'M2',
        averageSeconds: 60,
      },
      {
        route: '1',
        direction: 0,
        fromStopId: 'M2',
        toStopId: 'M3',
        averageSeconds: 120,
      },
    ]);

    expect(estimateEtaMinutes(catalog, observation('M1'), 'M3')).toBe(3);
  });

  it('accumulates every adjacent segment along the selected direction', () => {
    const catalog = catalogWithSegments([
      {
        route: '1',
        direction: 0,
        fromStopId: 'M1',
        toStopId: 'M2',
        medianSeconds: 30,
      },
      {
        route: '1',
        direction: 0,
        fromStopId: 'M2',
        toStopId: 'M3',
        medianSeconds: 31,
      },
    ]);

    expect(estimateEtaMinutes(catalog, observation('M1'), 'M3')).toBe(1);
  });

  it('returns unavailable when an adjacent segment is missing', () => {
    const catalog = catalogWithSegments([
      {
        route: '1',
        direction: 0,
        fromStopId: 'M1',
        toStopId: 'M2',
        medianSeconds: 55,
      },
    ]);

    expect(estimateEtaMinutes(catalog, observation('M1'), 'M3')).toBeNull();
  });

  it('returns unavailable when the target is before the observation station', () => {
    const catalog = catalogWithSegments([
      {
        route: '1',
        direction: 0,
        fromStopId: 'M1',
        toStopId: 'M2',
        medianSeconds: 55,
      },
      {
        route: '1',
        direction: 0,
        fromStopId: 'M2',
        toStopId: 'M3',
        medianSeconds: 65,
      },
    ]);

    expect(estimateEtaMinutes(catalog, observation('M2'), 'M1')).toBeNull();
  });

  it('returns unavailable for an unknown observation or target station', () => {
    const catalog = catalogWithSegments([]);

    expect(estimateEtaMinutes(catalog, observation('UNKNOWN'), 'M3')).toBeNull();
    expect(estimateEtaMinutes(catalog, observation('M1'), 'UNKNOWN')).toBeNull();
  });
});
