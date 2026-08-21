import { fileURLToPath } from 'node:url';

import {
  DSAT_ENDPOINT,
  DSAT_MAX_RESPONSE_BYTES,
  DSAT_ORIGIN,
  DSAT_REFERER,
  DSAT_TIMEOUT_MS,
} from '../server/config';
import {
  buildDsatProtocolRequest,
  createDsatToken,
  readBoundedDsatResponse as readProtocolDsatResponse,
} from '../server/dsat/dsat-protocol';

export { DSAT_ENDPOINT, DSAT_MAX_RESPONSE_BYTES, DSAT_ORIGIN, DSAT_REFERER, DSAT_TIMEOUT_MS, createDsatToken };
export const DSAT_USAGE = 'npm run dsat:test -- --route 1 --direction 0';

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

export class DsatUsageError extends Error {
  constructor() {
    super('Invalid DSAT probe arguments');
    this.name = 'DsatUsageError';
  }
}

export function buildDsatProbeRequest(input: DsatProbeInput): DsatProbeRequest {
  return buildDsatProtocolRequest({
    route: input.route,
    direction: input.direction,
    origin: DSAT_ORIGIN,
    referer: DSAT_REFERER,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

function timeoutError(): DOMException {
  return new DOMException('DSAT 請求逾時', 'TimeoutError');
}

export async function readBoundedDsatResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  try {
    return await readProtocolDsatResponse(response, maxBytes, signal);
  } catch (error) {
    if (error instanceof Error && error.message.includes('size limit')) {
      throw new DsatProbeError('response-too-large');
    }
    if (error instanceof Error && error.message.includes('readable body')) {
      throw new DsatProbeError('missing-body');
    }
    throw error;
  }
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
  if (error instanceof DsatUsageError) {
    return `DSAT 測試用法：${DSAT_USAGE}`;
  }
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
    throw new DsatUsageError();
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
