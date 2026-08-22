import { describe, expect, it } from 'vitest';

import type { ParkingFacility } from '../../../shared/parking-contract';
import { distanceMeters, displayParkingSpace, filterAndSortParkingFacilities, parkingNavigationUrl } from './parking-utils';

function facility(overrides: Partial<ParkingFacility> = {}): ParkingFacility {
  return {
    id: '42',
    name: '甲停車場',
    location: '澳門半島 甲路',
    entrance: '正門',
    latitude: 22.198,
    longitude: 113.543,
    spaces: { car: 20, motorcycle: 4, electricCar: 2, electricMotorcycle: 1, accessible: 1 },
    updatedAt: '2026-08-22T10:00:00+08:00',
    suspended: false,
    ...overrides,
  };
}

describe('parking local-only helpers', () => {
  it('searches normalized Traditional Chinese name/location and sorts by requested strategy', () => {
    const facilities = [
      facility({ id: '42', name: '甲停車場', spaces: { car: 20, motorcycle: 0, electricCar: null, electricMotorcycle: null, accessible: null } }),
      facility({ id: '7', name: '乙停車場', location: '氹仔乙路', spaces: { car: 80, motorcycle: 0, electricCar: null, electricMotorcycle: null, accessible: null } }),
      facility({ id: '9', name: '丙停車場', latitude: null, longitude: null, spaces: { car: null, motorcycle: null, electricCar: null, electricMotorcycle: null, accessible: null } }),
    ];

    expect(filterAndSortParkingFacilities(facilities, { query: '  氹仔  ', sort: 'name' }).map((item) => item.id)).toEqual(['7']);
    expect(filterAndSortParkingFacilities(facilities, { sort: 'spaces' }).map((item) => item.id)).toEqual(['7', '42', '9']);
    expect(filterAndSortParkingFacilities(facilities, { sort: 'distance', position: { latitude: 22.198, longitude: 113.543 } }).map((item) => item.id)).toEqual(['42', '7', '9']);
  });

  it('keeps GPS distance local and renders null or suspended values as an em dash', () => {
    expect(distanceMeters({ latitude: 22.198, longitude: 113.543 }, facility())).toBe(0);
    expect(displayParkingSpace(null)).toBe('—');
    expect(displayParkingSpace(0)).toBe('0');
    expect(displayParkingSpace(20, true)).toBe('—');
  });

  it('uses a coordinate URL when available and an official-name query fallback otherwise', () => {
    expect(parkingNavigationUrl(facility())).toContain('https://www.google.com/maps/dir/?api=1&destination=22.198%2C113.543');
    expect(parkingNavigationUrl(facility({ latitude: null, longitude: null }))).toContain('https://www.google.com/maps/search/?api=1&query=');
    expect(parkingNavigationUrl(facility({ latitude: null, longitude: null }))).toContain(encodeURIComponent('甲停車場, 澳門半島 甲路'));
  });
});
