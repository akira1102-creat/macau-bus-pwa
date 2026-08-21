import type {
  RealtimeRouteResponse,
  TransitCatalog,
} from '../../shared/transit-contract';

/** Explicit observation station for callers displaying one bus at a time. */
export interface EtaEstimateOptions {
  catalog: TransitCatalog;
  realtime: RealtimeRouteResponse;
  targetStopId: string;
  observationStationCode: string;
  /** Explicit instant used for time-bucket selection (Macau local time). */
  at?: Date;
  /** Injectable clock used when `at` is not provided. */
  clock?: () => Date;
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

function macauHour(at: Date): number | null {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    return null;
  }
  const hourPart = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hourCycle: 'h23',
    timeZone: 'Asia/Macau',
  }).formatToParts(at).find((part) => part.type === 'hour')?.value;
  const hour = Number(hourPart);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

function bucketHour(timeBucket: string | undefined): number | null {
  if (!timeBucket || !/^\d{1,2}$/.test(timeBucket.trim())) {
    return null;
  }
  const hour = Number(timeBucket.trim());
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

/**
 * Select a current-hour segment when present. If that hour is absent, use the
 * arithmetic mean of every bucket for this segment; this deterministic
 * aggregate avoids relying on upstream object/array order. A malformed or
 * negative median invalidates the selected set and never falls back to an
 * average value.
 */
function segmentSecondsForHour(
  segments: TransitCatalog['segmentTimes'],
  hour: number | null,
): number | null {
  const selected = hour === null
    ? []
    : segments.filter((segment) => bucketHour(segment.timeBucket) === hour);
  const candidates = selected.length > 0 ? selected : segments;
  if (candidates.length === 0) {
    return null;
  }

  const values: number[] = [];
  for (const candidate of candidates) {
    const seconds = segmentSeconds(candidate);
    if (seconds === null) {
      return null;
    }
    values.push(seconds);
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function estimate(
  catalog: TransitCatalog,
  realtime: RealtimeRouteResponse,
  targetStopId: string,
  observationStationCode?: string,
  timing: Pick<EtaEstimateOptions, 'at' | 'clock'> = {},
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

  const observation = observationStationCode?.trim();
  if (!observation) {
    return null;
  }

  const isObserved = realtime.buses.some((bus) => bus.stationCode.trim() === observation);
  if (!isObserved || !direction.stopIds.includes(observation)) {
    return null;
  }

  const observationIndex = direction.stopIds.indexOf(observation);
  if (observationIndex < 0 || targetIndex < observationIndex) {
    return null;
  }
  if (targetIndex === observationIndex) {
    return 0;
  }

  const at = timing.at ?? timing.clock?.() ?? new Date();
  const hour = macauHour(at);

  let totalSeconds = 0;
  for (let index = observationIndex; index < targetIndex; index += 1) {
    const fromStopId = direction.stopIds[index];
    const toStopId = direction.stopIds[index + 1];
    if (!fromStopId || !toStopId) {
      return null;
    }
    const segments = catalog.segmentTimes.filter(
      (candidate) =>
        candidate.route === realtime.route.trim()
        && candidate.direction === realtime.direction
        && candidate.fromStopId === fromStopId
        && candidate.toStopId === toStopId,
    );
    if (segments.length === 0) {
      return null;
    }
    const seconds = segmentSecondsForHour(segments, hour);
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
  observationStationCode: string,
): EtaMinutes;
export function estimateEtaMinutes(
  first: TransitCatalog | EtaEstimateOptions,
  second?: RealtimeRouteResponse,
  third?: string,
  fourth?: string,
): EtaMinutes {
  if ('catalog' in first && 'realtime' in first) {
    return estimate(first.catalog, first.realtime, first.targetStopId, first.observationStationCode, first);
  }
  if (!second || third === undefined || fourth === undefined) {
    return null;
  }
  return estimate(first, second, third, fourth);
}
