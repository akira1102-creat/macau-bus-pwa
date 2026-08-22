import type { CurrentPosition } from '../../infra/geolocation';
import type { ParkingFacility } from '../../../shared/parking-contract';

export type ParkingSort = 'distance' | 'spaces' | 'name' | 'nearby' | 'available';

const EARTH_RADIUS_METERS = 6_371_000;

export function normalizeParkingText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
}

export function parkingHasCoordinates(facility: ParkingFacility): facility is ParkingFacility & { latitude: number; longitude: number } {
  return facility.latitude !== null && facility.longitude !== null;
}

export function distanceMeters(position: Pick<CurrentPosition, 'latitude' | 'longitude'>, facility: ParkingFacility): number | null {
  if (!parkingHasCoordinates(facility)) {
    return null;
  }
  const latitudeDelta = (facility.latitude - position.latitude) * Math.PI / 180;
  const longitudeDelta = (facility.longitude - position.longitude) * Math.PI / 180;
  const fromLatitude = position.latitude * Math.PI / 180;
  const toLatitude = facility.latitude * Math.PI / 180;
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.sin(longitudeDelta / 2) ** 2 * Math.cos(fromLatitude) * Math.cos(toLatitude);
  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine)));
}

export function displayParkingSpace(value: number | null, suspended = false): string {
  return suspended || value === null ? '—' : String(value);
}

export function formatParkingDistance(value: number | null): string {
  if (value === null) {
    return '—';
  }
  return value >= 1000 ? `${(value / 1000).toFixed(1)} 公里` : `${value} 米`;
}

export interface ParkingListFilterOptions {
  query?: string;
  sort?: ParkingSort;
  position?: Pick<CurrentPosition, 'latitude' | 'longitude'> | null;
}

export function filterAndSortParkingFacilities(
  facilities: readonly ParkingFacility[],
  options: ParkingListFilterOptions = {},
): ParkingFacility[] {
  const query = normalizeParkingText(options.query ?? '');
  const visible = facilities.filter((facility) => {
    if (!query) {
      return true;
    }
    return normalizeParkingText([facility.name, facility.location ?? '', facility.entrance ?? ''].join(' ')).includes(query);
  });
  const sort = options.sort ?? 'distance';
  const withIndex = visible.map((facility, index) => ({
    facility,
    index,
    distance: options.position ? distanceMeters(options.position, facility) : null,
  }));
  withIndex.sort((left, right) => {
    if (sort === 'distance' || sort === 'nearby') {
      if (left.distance !== null && right.distance !== null && left.distance !== right.distance) {
        return left.distance - right.distance;
      }
      if (left.distance !== right.distance) {
        return left.distance === null ? 1 : -1;
      }
    } else if (sort === 'spaces' || sort === 'available') {
      const leftSpaces = left.facility.suspended ? null : left.facility.spaces.car;
      const rightSpaces = right.facility.suspended ? null : right.facility.spaces.car;
      if (leftSpaces !== null && rightSpaces !== null && leftSpaces !== rightSpaces) {
        return rightSpaces - leftSpaces;
      }
      if (leftSpaces !== rightSpaces) {
        return leftSpaces === null ? 1 : -1;
      }
    } else if (sort === 'name') {
      const byName = left.facility.name.localeCompare(right.facility.name, 'zh-Hant');
      if (byName !== 0) {
        return byName;
      }
    }
    return left.index - right.index;
  });
  return withIndex.map(({ facility }) => facility);
}

export function parkingNavigationUrl(facility: ParkingFacility): string {
  if (parkingHasCoordinates(facility)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${facility.latitude},${facility.longitude}`)}`;
  }
  const query = [facility.name, facility.location ?? '澳門'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function openParkingNavigation(facility: ParkingFacility): string {
  const url = parkingNavigationUrl(facility);
  const opened = globalThis.window?.open(url, '_blank', 'noopener,noreferrer');
  if (opened === null && globalThis.window) {
    try {
      globalThis.window.location.assign(url);
    } catch {
      // A popup/navigation blocker is still a valid URL result for the caller.
    }
  }
  return url;
}

export const sortParkingFacilities = filterAndSortParkingFacilities;
