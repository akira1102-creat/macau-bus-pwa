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

function observation(
  stationCode: string,
  direction: 0 | 1 = 0,
  stationCodes: string[] = [stationCode],
): RealtimeRouteResponse {
  return {
    route: '1',
    direction,
    updatedAt: '2026-08-21T00:00:00.000Z',
    ageSeconds: 0,
    stale: false,
    source: 'DSAT observation',
    buses: stationCodes.map((currentStationCode, index) => ({
      plate: `SANITIZED-PLATE-00${index + 1}`,
      stationCode: currentStationCode,
      speedKph: 10,
      status: '行駛中',
      passengerFlow: null,
      busType: null,
      facilities: null,
    })),
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

    expect(estimateEtaMinutes(catalog, observation('M1'), 'M3', 'M1')).toBe(2);
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

    expect(estimateEtaMinutes(catalog, observation('M1'), 'M3', 'M1')).toBe(3);
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

    expect(estimateEtaMinutes(catalog, observation('M1'), 'M3', 'M1')).toBe(1);
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

    expect(estimateEtaMinutes(catalog, observation('M1'), 'M3', 'M1')).toBeNull();
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

    expect(estimateEtaMinutes(catalog, observation('M2'), 'M1', 'M2')).toBeNull();
  });

  it('returns unavailable for an unknown observation or target station', () => {
    const catalog = catalogWithSegments([]);

    expect(estimateEtaMinutes(catalog, observation('UNKNOWN'), 'M3', 'UNKNOWN')).toBeNull();
    expect(estimateEtaMinutes(catalog, observation('M1'), 'UNKNOWN', 'M1')).toBeNull();
  });

  it('does not guess among multiple buses when the observation station is omitted', () => {
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
    const realtime = observation('M1', 0, ['M1', 'M2']);

    expect(estimateEtaMinutes(catalog, realtime, 'M3')).toBeNull();
    expect(estimateEtaMinutes(catalog, realtime, 'M3', 'M1')).toBe(2);
    expect(estimateEtaMinutes(catalog, realtime, 'M3', 'M2')).toBe(1);
  });

  it('follows the explicitly selected reverse direction', () => {
    const catalog = catalogWithSegments([
      {
        route: '1',
        direction: 1,
        fromStopId: 'M3',
        toStopId: 'M2',
        medianSeconds: 60,
      },
      {
        route: '1',
        direction: 1,
        fromStopId: 'M2',
        toStopId: 'M1',
        medianSeconds: 120,
      },
    ]);

    expect(estimateEtaMinutes(catalog, observation('M3', 1), 'M1', 'M3')).toBe(3);
  });
});
