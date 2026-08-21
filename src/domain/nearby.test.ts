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
const earthRadiusMeters = 6_371_000;

function stopAtMeters(id: string, distanceMeters: number): BusStop {
  // Equatorial longitude has a direct inverse for Haversine distance. The tiny
  // representational overshoot exercises the production epsilon, not a wider UI radius.
  const longitude = ((distanceMeters / earthRadiusMeters) * 180) / Math.PI * (1 + 1e-14);
  return {
    id,
    name: id,
    nameCn: `${id}站`,
    coordinates: [longitude, 0],
    routeIds: ['1'],
  };
}

const boundaryCatalog = {
  stops: [
    stopAtMeters('R300', 300),
    stopAtMeters('R500', 500),
    stopAtMeters('R1000', 1_000),
    stopAtMeters('OVER1000', 1_001),
  ],
} as TransitCatalog;

const halfMillimetreBeyondCatalog = {
  stops: [
    stopAtMeters('R300', 300),
    stopAtMeters('R300_HALF_MM_BEYOND', 300.0005),
  ],
} as TransitCatalog;

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

  it.each([
    [300, ['R300']],
    [500, ['R300', 'R500']],
    [1_000, ['R300', 'R500', 'R1000']],
  ])('includes mathematically constructed exact %sm boundary points only', (radiusMeters, expectedIds) => {
    expect(findNearbyStops(boundaryCatalog, origin, radiusMeters).map((entry) => entry.stop.id)).toEqual(expectedIds);
  });

  it('excludes a point half a millimetre beyond the selected radius', () => {
    expect(findNearbyStops(halfMillimetreBeyondCatalog, origin, 300).map((entry) => entry.stop.id)).toEqual(['R300']);
  });
});
