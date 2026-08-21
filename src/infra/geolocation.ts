export interface CurrentPosition {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
}

export interface GetCurrentPositionOptions {
  geolocation?: Pick<Geolocation, 'getCurrentPosition'>;
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

export type GeolocationErrorCode =
  | 'unsupported'
  | 'permission-denied'
  | 'position-unavailable'
  | 'timeout'
  | 'invalid-position';

export class CurrentPositionError extends Error {
  readonly code: GeolocationErrorCode;

  constructor(code: GeolocationErrorCode, cause?: unknown) {
    super(`current position unavailable: ${code}`, cause === undefined ? undefined : { cause });
    this.name = 'CurrentPositionError';
    this.code = code;
  }
}

function mapPositionError(error: GeolocationPositionError): CurrentPositionError {
  if (error.code === 1) {
    return new CurrentPositionError('permission-denied');
  }
  if (error.code === 2) {
    return new CurrentPositionError('position-unavailable');
  }
  if (error.code === 3) {
    return new CurrentPositionError('timeout');
  }
  return new CurrentPositionError('position-unavailable', error);
}

function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

/** Request one browser position. It performs no network call and never logs coordinates. */
export function getCurrentPositionOnce(options: GetCurrentPositionOptions = {}): Promise<CurrentPosition> {
  const geolocation = options.geolocation ?? globalThis.navigator?.geolocation;
  if (!geolocation) {
    return Promise.reject(new CurrentPositionError('unsupported'));
  }

  const positionOptions: PositionOptions = {};
  if (options.enableHighAccuracy !== undefined) {
    positionOptions.enableHighAccuracy = options.enableHighAccuracy;
  }
  if (options.timeout !== undefined) {
    positionOptions.timeout = options.timeout;
  }
  if (options.maximumAge !== undefined) {
    positionOptions.maximumAge = options.maximumAge;
  }

  return new Promise<CurrentPosition>((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
          reject(new CurrentPositionError('invalid-position'));
          return;
        }
        const accuracyMeters = Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null;
        resolve({ latitude, longitude, accuracyMeters });
      },
      (error) => reject(mapPositionError(error)),
      positionOptions,
    );
  });
}
