import {
  DSAT_ENDPOINT,
  DSAT_MAX_RESPONSE_BYTES,
  DSAT_ORIGIN,
  DSAT_REFERER,
  DSAT_TIMEOUT_MS,
} from '../config';
import {
  buildDsatProtocolRequest,
  createDsatToken,
  readBoundedDsatResponse,
} from './dsat-protocol';
import { DsatParseError, parseDsatRouteResponse, type ParsedDsatRouteResponse } from './dsat-parser';

export { createDsatToken };

export type DsatClientErrorCode =
  | 'timeout'
  | 'network'
  | 'http'
  | 'application-header'
  | 'invalid-json'
  | 'invalid-payload'
  | 'missing-body'
  | 'response-too-large';

export class DsatClientError extends Error {
  readonly code: DsatClientErrorCode;
  readonly status: number | undefined;
  readonly applicationHeader: string | undefined;

  constructor(
    code: DsatClientErrorCode,
    details: { status?: number; applicationHeader?: string; cause?: unknown } = {},
  ) {
    super(`DSAT request failed: ${code}`, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'DsatClientError';
    this.code = code;
    this.status = details.status;
    this.applicationHeader = details.applicationHeader;
  }
}

export interface DsatClientResponse extends ParsedDsatRouteResponse {
  raw: unknown;
}

export interface DsatClientOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  endpoint?: string;
  origin?: string;
  referer?: string;
  maxResponseBytes?: number;
  now?: () => Date;
}

export interface DsatClient {
  fetchRoute(route: string, direction: 0 | 1): Promise<DsatClientResponse>;
}

function timeoutError(): DsatClientError {
  return new DsatClientError('timeout');
}

function mapProtocolError(error: unknown, signal: AbortSignal, timedOut: boolean): DsatClientError {
  if (error instanceof DsatClientError) {
    return error;
  }
  if (error instanceof DsatParseError) {
    if (error.code === 'application-header') {
      return new DsatClientError('application-header', {
        cause: error,
        ...(error.applicationHeader === undefined ? {} : { applicationHeader: error.applicationHeader }),
      });
    }
    return new DsatClientError(error.code, { cause: error });
  }
  if (timedOut || signal.aborted || (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError'))) {
    return timeoutError();
  }
  if (error instanceof Error && error.message.includes('size limit')) {
    return new DsatClientError('response-too-large', { cause: error });
  }
  if (error instanceof Error && error.message.includes('readable body')) {
    return new DsatClientError('missing-body', { cause: error });
  }
  if (error instanceof SyntaxError) {
    return new DsatClientError('invalid-json', { cause: error });
  }
  return new DsatClientError('network', { cause: error });
}

export function createDsatClient(options: DsatClientOptions = {}): DsatClient {
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DSAT_TIMEOUT_MS;
  const endpoint = options.endpoint ?? DSAT_ENDPOINT;
  const maxResponseBytes = options.maxResponseBytes ?? DSAT_MAX_RESPONSE_BYTES;
  const now = options.now ?? (() => new Date());
  const origin = options.origin ?? DSAT_ORIGIN;
  const referer = options.referer ?? DSAT_REFERER;

  return {
    async fetchRoute(route, direction) {
      const request = buildDsatProtocolRequest({ route, direction, now: now(), origin, referer });
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(timeoutError());
      }, timeoutMs);

      try {
        let response: Response;
        try {
          response = await fetcher(endpoint, {
            method: 'POST',
            headers: request.headers,
            body: request.body,
            signal: controller.signal,
          });
        } catch (error) {
          throw mapProtocolError(error, controller.signal, timedOut);
        }
        if (!response.ok) {
          throw new DsatClientError('http', { status: response.status });
        }

        let text: string;
        try {
          text = await readBoundedDsatResponse(response, maxResponseBytes, controller.signal);
        } catch (error) {
          throw mapProtocolError(error, controller.signal, timedOut);
        }

        let raw: unknown;
        try {
          raw = JSON.parse(text) as unknown;
        } catch (error) {
          throw new DsatClientError('invalid-json', { cause: error });
        }
        let parsed: ParsedDsatRouteResponse;
        try {
          parsed = parseDsatRouteResponse(raw);
        } catch (error) {
          throw mapProtocolError(error, controller.signal, timedOut);
        }
        return { ...parsed, raw };
      } catch (error) {
        throw mapProtocolError(error, controller.signal, timedOut);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
