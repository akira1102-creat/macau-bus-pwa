import { z } from 'zod';

import { DirectionIdSchema } from '../../shared/transit-contract';

export const ArrivalResultSchema = z.object({
  stopId: z.string().trim().min(1),
  route: z.string().trim().min(1),
  direction: DirectionIdSchema,
  plate: z.string(),
  remainingStops: z.number().int().nonnegative(),
});

export const ArrivalsResponseSchema = z.object({
  updatedAt: z.string().datetime({ offset: true }),
  arrivals: z.array(ArrivalResultSchema),
});

export type ArrivalResult = z.infer<typeof ArrivalResultSchema>;
export type ArrivalsResponse = z.infer<typeof ArrivalsResponseSchema>;

export interface ArrivalsClientOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
}

export interface ArrivalsClient {
  getForStops(stopIds: readonly string[], signal?: AbortSignal): Promise<ArrivalsResponse>;
}

export type ArrivalsApiErrorCode = 'invalid-request' | 'network' | 'http' | 'invalid-response' | 'aborted';

export class ArrivalsApiError extends Error {
  readonly code: ArrivalsApiErrorCode;
  readonly status: number | undefined;

  constructor(code: ArrivalsApiErrorCode, details: { status?: number; cause?: unknown } = {}) {
    super(`arrivals request failed: ${code}`, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'ArrivalsApiError';
    this.code = code;
    this.status = details.status;
  }
}

function arrivalsUrl(baseUrl: string): string {
  const prefix = baseUrl.trim().replace(/\/+$/, '');
  const apiPrefix = !prefix
    ? '/api'
    : /(?:^|\/)api$/.test(prefix)
      ? prefix
      : `${prefix}/api`;
  return `${apiPrefix}/bus/arrivals`;
}

function normalizeStopIds(stopIds: readonly string[]): string[] {
  if (!Array.isArray(stopIds)) {
    throw new ArrivalsApiError('invalid-request');
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const stopId of stopIds) {
    if (typeof stopId !== 'string') {
      throw new ArrivalsApiError('invalid-request');
    }
    const value = stopId.trim();
    if (!value || seen.has(value)) {
      if (!value) {
        throw new ArrivalsApiError('invalid-request');
      }
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }

  if (normalized.length === 0 || normalized.length > 5) {
    throw new ArrivalsApiError('invalid-request');
  }
  return normalized;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError';
}

/** Browser-side normalized adapter for the batch arrivals endpoint. */
export async function getArrivalsForStops(
  stopIds: readonly string[],
  options: ArrivalsClientOptions & { signal?: AbortSignal } = {},
): Promise<ArrivalsResponse> {
  const normalizedStopIds = normalizeStopIds(stopIds);
  const signal = options.signal;
  if (signal?.aborted) {
    throw new ArrivalsApiError('aborted');
  }

  const fetcher = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetcher(arrivalsUrl(options.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? ''), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ stopIds: normalizedStopIds }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw new ArrivalsApiError('aborted', { cause: error });
    }
    throw new ArrivalsApiError('network', { cause: error });
  }

  if (!response.ok) {
    throw new ArrivalsApiError('http', { status: response.status });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ArrivalsApiError('invalid-response', { cause: error });
  }

  try {
    return ArrivalsResponseSchema.parse(payload);
  } catch (error) {
    throw new ArrivalsApiError('invalid-response', { cause: error });
  }
}

export function createArrivalsClient(options: ArrivalsClientOptions = {}): ArrivalsClient {
  return {
    getForStops: (stopIds, signal) => signal === undefined
      ? getArrivalsForStops(stopIds, options)
      : getArrivalsForStops(stopIds, { ...options, signal }),
  };
}
