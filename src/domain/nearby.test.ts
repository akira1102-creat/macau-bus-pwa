import { describe, expect, it } from 'vitest';

import type { BusStop, TransitCatalog } from '../../shared/transit-contract';
import { findNearbyStops } from './nearby';

const stops: BusStop[] = [
  {
    id: 'C',
    name: 'C',
    nameCn: '丙站',
    coordinates: [0.004, 0],
    routeIds: ['1'],
  },
  {
    id: 'A',
    name: 'A',
    nameCn: '甲站',
    coordinates: [0, 0],
    routeIds: ['1'],
  },
  {
    id: 'D',
    name: 'D',
    nameCn: '丁站',
    coordinates: [0.0091, 0],
    routeIds: ['1'],
  },
  {
    id: 'B',
    name: 'B',
    nameCn: '乙站',
    coordinates: [0.002, 0],
    routeIds: ['1'],
  },
];

const catalog = { stops } as TransitCatalog;
const origin = { latitude: 0, longitude: 0 };

describe('findNearbyStops', () => {
  it('orders stops by local Haversine distance', () => {
    const nearby = findNearbyStops(catalog, { latitude: 0, longitude: 0 }, 1_200);

    expect(nearby.map((entry) => entry.stop.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(nearby[0]?.distanceMeters).toBe(0);
    expect(nearby[1]?.distanceMeters).toBeGreaterThan(200);
    expect(nearby[1]?.distanceMeters).toBeLessThan(230);
  });

  it.each([
    [300, ['A', 'B']],
    [500, ['A', 'B', 'C']],
    [1_000, ['A', 'B', 'C']],
  ])('uses inclusive %sm radius threshold', (radiusMeters, expectedIds) => {
    expect(findNearbyStops(catalog, origin, radiusMeters).map((entry) => entry.stop.id)).toEqual(expectedIds);
  });

  it('does not use a network dependency or mutate the catalog stops', () => {
    const before = structuredClone(stops);

    findNearbyStops(catalog, origin, 300);

    expect(stops).toEqual(before);
  });
});
