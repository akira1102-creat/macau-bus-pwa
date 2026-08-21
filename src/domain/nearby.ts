import type { BusStop, TransitCatalog } from '../../shared/transit-contract';

export type NearbyPosition =
  | { latitude: number; longitude: number }
  | readonly [longitude: number, latitude: number];

export interface NearbyStop {
  stop: BusStop;
  distanceMeters: number;
}

const EARTH_RADIUS_METERS = 6_371_000;
// One millimetre absorbs IEEE-754 inverse/projection rounding without widening
// a user-selected 300m/500m/1km radius by a meaningful amount.
const DISTANCE_EPSILON_METERS = 0.001;

function coordinatesFromPosition(position: NearbyPosition): readonly [number, number] | null {
  if (Array.isArray(position)) {
    const [longitude, latitude] = position;
    return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null;
  }
  if ('longitude' in position && 'latitude' in position) {
    return Number.isFinite(position.longitude) && Number.isFinite(position.latitude)
      ? [position.longitude, position.latitude]
      : null;
  }
  return null;
}

function validCoordinates(coordinates: readonly [number, number]): boolean {
  const [longitude, latitude] = coordinates;
  return (
    Number.isFinite(longitude)
    && Number.isFinite(latitude)
    && longitude >= -180
    && longitude <= 180
    && latitude >= -90
    && latitude <= 90
  );
}

/** Calculate a local-only Haversine distance for [longitude, latitude] pairs. */
export function haversineDistanceMeters(
  from: readonly [number, number],
  to: readonly [number, number],
): number {
  if (!validCoordinates(from) || !validCoordinates(to)) {
    return Number.POSITIVE_INFINITY;
  }
  const [fromLongitude, fromLatitude] = from;
  const [toLongitude, toLatitude] = to;
  const latitudeDelta = ((toLatitude - fromLatitude) * Math.PI) / 180;
  const longitudeDelta = ((toLongitude - fromLongitude) * Math.PI) / 180;
  const fromLatitudeRadians = (fromLatitude * Math.PI) / 180;
  const toLatitudeRadians = (toLatitude * Math.PI) / 180;
  const a =
    Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitudeRadians) * Math.cos(toLatitudeRadians) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type StopsSource = Pick<TransitCatalog, 'stops'> | readonly BusStop[];

function stopsFrom(source: StopsSource): readonly BusStop[] {
  return 'stops' in source ? source.stops : source;
}

export function findNearbyStops(
  source: StopsSource,
  position: NearbyPosition,
  radiusMeters: number,
): NearbyStop[] {
  if (!Number.isFinite(radiusMeters) || radiusMeters < 0) {
    return [];
  }
  const positionCoordinates = coordinatesFromPosition(position);
  if (!positionCoordinates || !validCoordinates(positionCoordinates)) {
    return [];
  }

  return stopsFrom(source)
    .map((stop, index) => ({
      stop,
      distanceMeters: haversineDistanceMeters(positionCoordinates, stop.coordinates),
      index,
    }))
    .filter((entry) => entry.distanceMeters <= radiusMeters + DISTANCE_EPSILON_METERS)
    .sort((left, right) => left.distanceMeters - right.distanceMeters || left.index - right.index)
    .map(({ stop, distanceMeters }) => ({ stop, distanceMeters }));
}

export const NEARBY_RADII_METERS = [300, 500, 1_000] as const;
