import {
  ParkingSnapshotSchema,
  type ParkingSnapshot,
} from '../../shared/parking-contract';

export interface ParkingApiClientOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
}

export type ParkingApiErrorCode = 'network' | 'http' | 'invalid-response' | 'aborted';

export class ParkingApiError extends Error {
  readonly code: ParkingApiErrorCode;
  readonly status: number | undefined;

  constructor(code: ParkingApiErrorCode, details: { status?: number; cause?: unknown } = {}) {
    super(`parking request failed: ${code}`, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'ParkingApiError';
    this.code = code;
    this.status = details.status;
  }
}

export interface ParkingApiClient {
  getSnapshot(signal?: AbortSignal): Promise<ParkingSnapshot>;
}

function parkingUrl(baseUrl: string): string {
  const prefix = baseUrl.trim().replace(/\/+$/, '');
  if (!prefix) {
    return '/api/parking';
  }
  return /(?:^|\/)api$/.test(prefix) ? `${prefix}/parking` : `${prefix}/api/parking`;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError';
}

export async function getParkingSnapshot(options: ParkingApiClientOptions & { signal?: AbortSignal } = {}): Promise<ParkingSnapshot> {
  const signal = options.signal;
  if (signal?.aborted) {
    throw new ParkingApiError('aborted');
  }
  const fetcher = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetcher(parkingUrl(options.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? ''), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw new ParkingApiError('aborted', { cause: error });
    }
    throw new ParkingApiError('network', { cause: error });
  }

  if (!response.ok) {
    throw new ParkingApiError('http', { status: response.status });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ParkingApiError('invalid-response', { cause: error });
  }

  try {
    return ParkingSnapshotSchema.parse(payload);
  } catch (error) {
    throw new ParkingApiError('invalid-response', { cause: error });
  }
}

export function createParkingApiClient(options: ParkingApiClientOptions = {}): ParkingApiClient {
  return {
    getSnapshot: (signal) => signal === undefined
      ? getParkingSnapshot(options)
      : getParkingSnapshot({ ...options, signal }),
  };
}
