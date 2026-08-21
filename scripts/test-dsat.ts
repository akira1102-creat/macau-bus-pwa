import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const DSAT_ENDPOINT = 'https://bis.dsat.gov.mo:37812/macauweb/routestation/bus';
export const DSAT_REFERER = 'https://bis.dsat.gov.mo:37812/macauweb/';

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
      referer: DSAT_REFERER,
      token: createDsatToken(body, input.now ?? new Date()),
    },
  };
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
  const response = await fetch(DSAT_ENDPOINT, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
  });
  const text = await response.text();
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
  console.log(`DSAT probe HTTP ${response.status}; application header=${applicationHeader}; stations=${routeInfo}; observations=${busCount}.`);
  if (!response.ok || applicationHeader !== '000') {
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
