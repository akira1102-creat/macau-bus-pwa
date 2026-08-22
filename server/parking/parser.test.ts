import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MACAU_BOUNDS,
  ParkingFacilitySchema,
} from '../../shared/parking-contract';
import {
  parseParkingDetailHtml,
  parseParkingRealtimeHtml,
} from './parser';

const realtimeFixture = readFileSync(
  fileURLToPath(new URL('../../tests/fixtures/dsat/parking-realtime-synthetic.html', import.meta.url)),
  'utf8',
);
const detailFixture = readFileSync(
  fileURLToPath(new URL('../../tests/fixtures/dsat/parking-detail-synthetic.html', import.meta.url)),
  'utf8',
);

describe('DSAT parking realtime parser', () => {
  it('parses five reordered space types, numeric IDs, entities, whitespace, and timestamps', () => {
    const [facility] = parseParkingRealtimeHtml(realtimeFixture);

    expect(facility).toMatchObject({
      id: '12345',
      name: '合成 停車場 & 東',
      updatedAt: '2026-08-22T10:00:01+08:00',
      suspended: false,
      spaces: {
        car: 12,
        motorcycle: 34,
        electricCar: 2,
        electricMotorcycle: 4,
        accessible: 3,
      },
    });
  });

  it('normalizes paused and unknown values to null and marks the facility suspended', () => {
    const facilities = parseParkingRealtimeHtml(realtimeFixture);

    expect(facilities).toHaveLength(2);
    expect(facilities[1]).toMatchObject({
      id: '67890',
      suspended: true,
      spaces: {
        car: null,
        motorcycle: null,
        electricCar: null,
        electricMotorcycle: null,
        accessible: null,
      },
    });
  });

  it('skips malformed rows and never invents a non-numeric official ID', () => {
    expect(parseParkingRealtimeHtml(realtimeFixture)).toHaveLength(2);
  });

  it('does not truncate malformed decimal space values into integers', () => {
    const malformed = `<tr><td><span class="style7">小數資料</span><img src="carpark_car.png">12.5</td><td><a href="carpark_detail.aspx?id=54321">open</a></td></tr>`;

    expect(parseParkingRealtimeHtml(malformed)[0]?.spaces.car).toBeNull();
  });
});

describe('DSAT parking detail parser and coordinate validation', () => {
  it('extracts normalized location, entrance, and only in-bounds coordinates', () => {
    const detail = parseParkingDetailHtml(detailFixture);

    expect(detail).toEqual({
      location: '合成路 地下停車場',
      entrance: '入口設於合成路 & 東門',
      latitude: 22.198,
      longitude: 113.551,
    });
  });

  it('rejects a coordinate outside the conservative Macau bounds', () => {
    const invalid = `<a data-latitude="${MACAU_BOUNDS.maxLatitude + 1}" data-longitude="${MACAU_BOUNDS.minLongitude}" href="#">map</a>`;
    const detail = parseParkingDetailHtml(invalid);

    expect(detail.latitude).toBeNull();
    expect(detail.longitude).toBeNull();
  });

  it('schema-rejects finite coordinates outside Macau even when all other fields are valid', () => {
    const result = ParkingFacilitySchema.safeParse({
      id: '12345',
      name: '合成停車場',
      location: null,
      entrance: null,
      latitude: MACAU_BOUNDS.maxLatitude + 0.01,
      longitude: MACAU_BOUNDS.minLongitude,
      spaces: {
        car: null,
        motorcycle: null,
        electricCar: null,
        electricMotorcycle: null,
        accessible: null,
      },
      updatedAt: null,
      suspended: false,
    });

    expect(result.success).toBe(false);
  });
});
