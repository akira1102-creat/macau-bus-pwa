import type {
  RealtimeRouteResponse,
  TransitCatalog,
} from '../../shared/transit-contract';

/** Optional explicit observation station for callers displaying one bus at a time. */
export interface EtaEstimateOptions {
  catalog: TransitCatalog;
  realtime: RealtimeRouteResponse;
  targetStopId: string;
  observationStationCode?: string;
}

export type EtaMinutes = number | null;

function isValidSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function segmentSeconds(segment: TransitCatalog['segmentTimes'][number]): number | null {
  // A present but malformed median is not silently hidden by a fallback average.
  if (segment.medianSeconds !== undefined) {
    return isValidSeconds(segment.medianSeconds) ? segment.medianSeconds : null;
  }
  return isValidSeconds(segment.averageSeconds) ? segment.averageSeconds : null;
}

function estimate(
  catalog: TransitCatalog,
  realtime: RealtimeRouteResponse,
  targetStopId: string,
  observationStationCode?: string,
): EtaMinutes {
  const route = catalog.routes.find((candidate) => candidate.id === realtime.route.trim());
  const direction = route?.directions.find((candidate) => candidate.id === realtime.direction);
  if (!route || !direction) {
    return null;
  }

  const targetId = targetStopId.trim();
  const targetIndex = direction.stopIds.indexOf(targetId);
  if (targetIndex < 0) {
    return null;
  }

  const requestedObservation = observationStationCode?.trim();
  const observation = requestedObservation
    ? requestedObservation
    : realtime.buses.find((bus) => direction.stopIds.includes(bus.stationCode.trim()))?.stationCode.trim();
  if (!observation) {
    return null;
  }

  const observationIndex = direction.stopIds.indexOf(observation);
  if (observationIndex < 0 || targetIndex < observationIndex) {
    return null;
  }
  if (targetIndex === observationIndex) {
    return 0;
  }

  let totalSeconds = 0;
  for (let index = observationIndex; index < targetIndex; index += 1) {
    const fromStopId = direction.stopIds[index];
    const toStopId = direction.stopIds[index + 1];
    if (!fromStopId || !toStopId) {
      return null;
    }
    const segment = catalog.segmentTimes.find(
      (candidate) =>
        candidate.route === realtime.route.trim()
        && candidate.direction === realtime.direction
        && candidate.fromStopId === fromStopId
        && candidate.toStopId === toStopId,
    );
    if (!segment) {
      return null;
    }
    const seconds = segmentSeconds(segment);
    if (seconds === null) {
      return null;
    }
    totalSeconds += seconds;
  }

  return Math.round(totalSeconds / 60);
}

export function estimateEtaMinutes(options: EtaEstimateOptions): EtaMinutes;
export function estimateEtaMinutes(
  catalog: TransitCatalog,
  realtime: RealtimeRouteResponse,
  targetStopId: string,
  observationStationCode?: string,
): EtaMinutes;
export function estimateEtaMinutes(
  first: TransitCatalog | EtaEstimateOptions,
  second?: RealtimeRouteResponse,
  third?: string,
  fourth?: string,
): EtaMinutes {
  if ('catalog' in first && 'realtime' in first) {
    return estimate(first.catalog, first.realtime, first.targetStopId, first.observationStationCode);
  }
  if (!second || third === undefined) {
    return null;
  }
  return estimate(first, second, third, fourth);
}
