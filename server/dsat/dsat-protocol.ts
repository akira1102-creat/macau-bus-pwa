import { createHash } from 'node:crypto';

import {
  DSAT_MAX_RESPONSE_BYTES,
  DSAT_ORIGIN,
  DSAT_REFERER,
  DSAT_TIMEOUT_MS,
} from '../config';

export { DSAT_MAX_RESPONSE_BYTES, DSAT_ORIGIN, DSAT_REFERER, DSAT_TIMEOUT_MS };

export interface DsatProtocolRequestInput {
  route: string;
  direction: 0 | 1;
  now?: Date;
  origin?: string;
  referer?: string;
}

export interface DsatProtocolRequest {
  body: string;
  headers: Record<string, string>;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function localTimestamp(now: Date): { date: string; monthDay: string; hourMinute: string } {
  const year = String(now.getFullYear());
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hour = pad(now.getHours());
  const minute = pad(now.getMinutes());
  return {
    date: `${year}${month}${day}${hour}${minute}`,
    monthDay: `${month}${day}`,
    hourMinute: `${hour}${minute}`,
  };
}

export function createDsatToken(rawBody: string, now = new Date()): string {
  const hash = createHash('md5').update(rawBody, 'utf8').digest('hex').toLowerCase();
  const timestamp = localTimestamp(now);
  return `${hash.slice(0, 4)}${timestamp.date.slice(0, 4)}${hash.slice(4, 12)}${timestamp.monthDay}${hash.slice(12, 24)}${timestamp.hourMinute}${hash.slice(24, 32)}`;
}

export function buildDsatProtocolRequest(input: DsatProtocolRequestInput): DsatProtocolRequest {
  const route = input.route.trim();
  if (!route) {
    throw new Error('route is required');
  }
  if (input.direction !== 0 && input.direction !== 1) {
    throw new Error('direction must be 0 or 1');
  }
  const body = [
    'action=dy',
    `routeName=${route}`,
    `dir=${input.direction}`,
    'lang=zh-tw',
    'routeType=0',
    'device=web',
  ].join('&');
  return {
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json, text/plain, */*',
      origin: input.origin ?? DSAT_ORIGIN,
      referer: input.referer ?? DSAT_REFERER,
      token: createDsatToken(body, input.now ?? new Date()),
    },
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('DSAT 請求已中止', 'AbortError');
}

export function responseTooLargeError(): Error {
  return new Error('DSAT response exceeds the configured size limit');
}

/** Read UTF-8 text without falling back to an unbounded Response.text(). */
export async function readBoundedDsatResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const contentLengthHeader = response.headers.get('content-length');
  const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : Number.NaN;
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw responseTooLargeError();
  }
  if (signal.aborted) {
    throw abortReason(signal);
  }
  if (!response.body) {
    throw new Error('DSAT response has no readable body');
  }

  const reader = response.body.getReader();
  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(abortReason(signal));
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    try {
      while (true) {
        const result = await Promise.race([reader.read(), abortPromise]) as ReadableStreamReadResult<Uint8Array>;
        if (result.done) {
          break;
        }
        if (!result.value) {
          continue;
        }
        totalBytes += result.value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw responseTooLargeError();
        }
        chunks.push(result.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  } finally {
    if (onAbort) {
      signal.removeEventListener('abort', onAbort);
    }
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(bytes);
}
