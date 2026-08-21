import {
  RealtimeRouteResponseSchema,
  type DirectionId,
  type RealtimeRouteResponse,
} from '../../shared/transit-contract';

export interface RealtimeApiClientOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  signal?: AbortSignal;
}

export type RealtimeApiErrorCode = 'invalid-request' | 'network' | 'http' | 'invalid-response';

export class RealtimeApiError extends Error {
  readonly code: RealtimeApiErrorCode;
  readonly status: number | undefined;

  constructor(code: RealtimeApiErrorCode, details: { status?: number; cause?: unknown } = {}) {
    super(`realtime request failed: ${code}`, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'RealtimeApiError';
    this.code = code;
    this.status = details.status;
  }
}

function routeUrl(route: string, direction: DirectionId, baseUrl: string): string {
  const normalizedRoute = route.trim();
  if (!normalizedRoute || (direction !== 0 && direction !== 1)) {
    throw new RealtimeApiError('invalid-request');
  }
  const prefix = baseUrl.replace(/\/+$/, '');
  return `${prefix}/api/bus/realtime/${encodeURIComponent(normalizedRoute)}/${direction}`;
}

/** Browser-side normalized realtime adapter. Upstream/raw payloads never leave the server. */
export async function getRealtimeRoute(
  route: string,
  direction: DirectionId,
  options: RealtimeApiClientOptions = {},
): Promise<RealtimeRouteResponse> {
  const url = routeUrl(route, direction, options.baseUrl ?? '');
  const fetcher = options.fetch ?? globalThis.fetch;

  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    throw new RealtimeApiError('network', { cause: error });
  }

  if (!response.ok) {
    throw new RealtimeApiError('http', { status: response.status });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new RealtimeApiError('invalid-response', { cause: error });
  }

  try {
    // Zod's object parser strips unknown fields, including any accidental `raw` member.
    return RealtimeRouteResponseSchema.parse(payload);
  } catch (error) {
    throw new RealtimeApiError('invalid-response', { cause: error });
  }
}

export function createRealtimeApiClient(options: RealtimeApiClientOptions = {}) {
  return {
    getRealtimeRoute: (route: string, direction: DirectionId) => getRealtimeRoute(route, direction, options),
  };
}
