import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const DSAT_ENDPOINT = 'https://bis.dsat.gov.mo:37812/macauweb/routestation/bus';
export const DSAT_REFERER = 'https://bis.dsat.gov.mo:37812/macauweb/';
export const DSAT_ORIGIN = 'https://bis.dsat.gov.mo:37812';
export const DSAT_TIMEOUT_MS = 4_000;
export const DSAT_MAX_RESPONSE_BYTES = 1_048_576;

export interface DsatProbeInput {
  route: string;
  direction: 0 | 1;
  now?: Date;
  /** Kept for deterministic callers; the current protocol does not use a nonce. */
  nonce?: string;
}

export interface DsatProbeRequest {
  body: string;
  headers: Record<string, string>;
}

export interface DsatFetchOptions {
  fetch?: typeof globalThis.fetch;
}

export interface DsatProbeResult {
  response: Response;
  text: string;
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

export function buildDsatProbeRequest(input: DsatProbeInput): DsatProbeRequest {
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
      origin: DSAT_ORIGIN,
      referer: DSAT_REFERER,
      token: createDsatToken(body, input.now ?? new Date()),
    },
  };
}

function timeoutError(): DOMException {
  return new DOMException('DSAT 請求逾時', 'TimeoutError');
}

function responseLimitError(maxBytes: number): Error {
  return new Error(`DSAT 回應超過大小限制（${maxBytes} bytes）`);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('DSAT 請求已中止', 'AbortError');
}

export async function readBoundedDsatResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const contentLengthHeader = response.headers.get('content-length');
  const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : Number.NaN;
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw responseLimitError(maxBytes);
  }
  if (signal.aborted) {
    throw abortReason(signal);
  }

  if (!response.body) {
    let onAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(abortReason(signal));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const text = await Promise.race([response.text(), abortPromise]);
      const size = new TextEncoder().encode(text).byteLength;
      if (size > maxBytes) {
        throw responseLimitError(maxBytes);
      }
      return text;
    } finally {
      if (onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    }
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
          throw responseLimitError(maxBytes);
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

export async function fetchDsatProbe(
  request: DsatProbeRequest,
  options: DsatFetchOptions = {},
): Promise<DsatProbeResult> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(timeoutError()), DSAT_TIMEOUT_MS);

  try {
    const response = await fetcher(DSAT_ENDPOINT, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    const text = await readBoundedDsatResponse(response, DSAT_MAX_RESPONSE_BYTES, controller.signal);
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const route = argument('--route');
  const directionValue = argument('--direction');
  const direction = directionValue === '0' ? 0 : directionValue === '1' ? 1 : undefined;
  if (!route || direction === undefined) {
    throw new Error('用法：npm run dsat:test -- --route 1 --direction 0');
  }

  const request = buildDsatProbeRequest({ route, direction });
  const { response, text } = await fetchDsatProbe(request);
  let parsed: unknown = undefined;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    // The endpoint may return an HTML error page; do not print its contents.
  }
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  const applicationHeader = record && typeof record.header === 'string' ? record.header : 'unknown';
  const data = record?.data && typeof record.data === 'object' && !Array.isArray(record.data) ? record.data as Record<string, unknown> : undefined;
  const routeInfo = Array.isArray(data?.routeInfo) ? data.routeInfo.length : 0;
  const busCount = Array.isArray(data?.routeInfo)
    ? data.routeInfo.reduce((count, station) => {
      if (!station || typeof station !== 'object' || Array.isArray(station)) return count;
      const buses = (station as Record<string, unknown>).busInfo;
      return count + (Array.isArray(buses) ? buses.length : 0);
    }, 0)
    : 0;
  console.log(`DSAT 測試 HTTP ${response.status}；application header=${applicationHeader}；站點=${routeInfo}；觀測=${busCount}。`);
  if (!response.ok || applicationHeader !== '000') {
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(`DSAT 測試失敗：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
