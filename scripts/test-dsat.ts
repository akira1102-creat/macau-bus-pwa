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

export type DsatProbeErrorCode =
  | 'http'
  | 'application-header'
  | 'invalid-json'
  | 'missing-body'
  | 'response-too-large';

export interface DsatProbeErrorDetails {
  status?: number;
  applicationHeader?: string;
}

export class DsatProbeError extends Error {
  readonly code: DsatProbeErrorCode;
  readonly status: number | undefined;
  readonly applicationHeader: string | undefined;

  constructor(code: DsatProbeErrorCode, details: DsatProbeErrorDetails = {}) {
    super(`DSAT probe failed: ${code}`);
    this.name = 'DsatProbeError';
    this.code = code;
    this.status = details.status;
    this.applicationHeader = details.applicationHeader;
  }
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

function responseLimitError(): DsatProbeError {
  return new DsatProbeError('response-too-large');
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
    throw responseLimitError();
  }
  if (signal.aborted) {
    throw abortReason(signal);
  }

  if (!response.body) {
    throw new DsatProbeError('missing-body');
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
          throw responseLimitError();
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

export interface DsatProbeSummary {
  status: number;
  applicationHeader: string;
  routeInfo: number;
  busCount: number;
}

function safeApplicationHeader(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : 'unknown';
}

export function summarizeDsatResponse(response: Response, text: string): DsatProbeSummary {
  if (!response.ok) {
    throw new DsatProbeError('http', { status: response.status });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new DsatProbeError('invalid-json', { status: response.status });
  }

  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : undefined;
  const applicationHeader = safeApplicationHeader(record?.header);
  if (applicationHeader !== '000') {
    throw new DsatProbeError('application-header', {
      status: response.status,
      applicationHeader,
    });
  }
  const data = record?.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : undefined;
  const routeInfo = Array.isArray(data?.routeInfo) ? data.routeInfo.length : 0;
  const busCount = Array.isArray(data?.routeInfo)
    ? data.routeInfo.reduce((count, station) => {
      if (!station || typeof station !== 'object' || Array.isArray(station)) return count;
      const buses = (station as Record<string, unknown>).busInfo;
      return count + (Array.isArray(buses) ? buses.length : 0);
    }, 0)
    : 0;
  return { status: response.status, applicationHeader, routeInfo, busCount };
}

function safeStatus(value: number | undefined): string {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? String(value)
    : '未知';
}

export function formatDsatProbeError(error: unknown): string {
  const prefix = 'DSAT 測試失敗：';
  if (error instanceof DsatProbeError) {
    switch (error.code) {
      case 'http':
        return `${prefix}上游 HTTP 狀態碼 ${safeStatus(error.status)}。`;
      case 'application-header':
        return `${prefix}DSAT application header ${safeApplicationHeader(error.applicationHeader)}（HTTP ${safeStatus(error.status)}）。`;
      case 'invalid-json':
        return `${prefix}回應不是有效 JSON。`;
      case 'missing-body':
        return `${prefix}回應沒有可讀取的內容。`;
      case 'response-too-large':
        return `${prefix}回應超過大小限制。`;
    }
  }
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return `${prefix}請求逾時或已中止。`;
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return `${prefix}請求逾時或已中止。`;
  }
  if (error instanceof TypeError || (error instanceof Error && error.name === 'TypeError')) {
    return `${prefix}網絡連線失敗。`;
  }
  return `${prefix}無法取得 DSAT 資料。`;
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
  const summary = summarizeDsatResponse(response, text);
  console.log(`DSAT 測試 HTTP ${summary.status}；application header=${summary.applicationHeader}；站點=${summary.routeInfo}；觀測=${summary.busCount}。`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(formatDsatProbeError(error));
    process.exitCode = 1;
  });
}
