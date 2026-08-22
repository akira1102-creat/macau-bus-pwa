import { readBoundedDsatResponse } from '../dsat/dsat-protocol';
import { RealtimeCache } from '../cache/realtime-cache';
import {
  ParkingFacilitySchema,
  ParkingSnapshotSchema,
  type ParkingFacility,
  type ParkingSnapshot,
} from '../../shared/parking-contract';
import { ParkingParseError, parseParkingDetailHtml, parseParkingRealtimeHtml } from './parser';

export const DSAT_PARKING_ENDPOINT = 'https://m.dsat.gov.mo/carpark.aspx';
export const DSAT_PARKING_DETAIL_ENDPOINT = 'https://m.dsat.gov.mo/carpark_detail.aspx';
export const PARKING_TIMEOUT_MS = 4_000;
export const PARKING_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const PARKING_CACHE_TTL_MS = 5_000;
export const PARKING_DETAIL_CONCURRENCY = 4;
export const PARKING_DETAIL_BUDGET_MS = 1_500;

export type ParkingClientErrorCode =
  | 'timeout'
  | 'aborted'
  | 'network'
  | 'http'
  | 'invalid-html'
  | 'response-too-large';

export class ParkingClientError extends Error {
  readonly code: ParkingClientErrorCode;
  readonly status: number | undefined;

  constructor(code: ParkingClientErrorCode, details: { status?: number; cause?: unknown } = {}) {
    super(`Parking request failed: ${code}`, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'ParkingClientError';
    this.code = code;
    this.status = details.status;
  }
}

export interface ParkingClient {
  fetchSnapshot(signal?: AbortSignal): Promise<ParkingSnapshot>;
}

type ParkingSourceSnapshot = Omit<ParkingSnapshot, 'stale'>;

export interface ParkingClientOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  endpoint?: string;
  detailEndpoint?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  cacheTtlMs?: number;
  detailConcurrency?: number;
  detailBudgetMs?: number;
  cache?: RealtimeCache<ParkingSourceSnapshot>;
}

interface FetchTextOptions {
  fetcher: typeof globalThis.fetch;
  signal?: AbortSignal;
  timeoutMs: number;
  maxResponseBytes: number;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Parking request aborted', 'AbortError');
}

function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new ParkingClientError('aborted', { cause: abortReason(signal) }));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ParkingClientError('aborted', { cause: abortReason(signal) }));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

function mapFetchError(error: unknown, controller: AbortController, timedOut: boolean, parentSignal?: AbortSignal): ParkingClientError {
  if (error instanceof ParkingClientError) return error;
  if (timedOut) return new ParkingClientError('timeout', { cause: error });
  if (parentSignal?.aborted) return new ParkingClientError('aborted', { cause: error });
  if (controller.signal.aborted) return new ParkingClientError('aborted', { cause: error });
  if (error instanceof Error && error.message.includes('size limit')) {
    return new ParkingClientError('response-too-large', { cause: error });
  }
  if (error instanceof Error && error.message.includes('readable body')) {
    return new ParkingClientError('network', { cause: error });
  }
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new ParkingClientError('timeout', { cause: error });
  }
  return new ParkingClientError('network', { cause: error });
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function fetchHtml(url: string, options: FetchTextOptions): Promise<string> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new ParkingClientError('timeout'));
  }, options.timeoutMs);
  let removeParentAbort: (() => void) | undefined;
  if (options.signal) {
    const onParentAbort = () => controller.abort(abortReason(options.signal!));
    if (options.signal.aborted) {
      onParentAbort();
    } else {
      options.signal.addEventListener('abort', onParentAbort, { once: true });
      removeParentAbort = () => options.signal?.removeEventListener('abort', onParentAbort);
    }
  }

  try {
    let response: Response;
    try {
      const responsePromise = Promise.resolve().then(() => options.fetcher(url, {
        method: 'GET',
        headers: {
          accept: 'text/html, application/xhtml+xml;q=0.9, */*;q=0.1',
          'user-agent': 'macau-bus-pwa-parking-adapter/1.0',
        },
        signal: controller.signal,
      }));
      response = await awaitWithAbort(responsePromise, controller.signal);
    } catch (error) {
      throw mapFetchError(error, controller, timedOut, options.signal);
    }
    if (!response.ok) {
      throw new ParkingClientError('http', { status: response.status });
    }
    try {
      return await readBoundedDsatResponse(response, options.maxResponseBytes, controller.signal);
    } catch (error) {
      throw mapFetchError(error, controller, timedOut, options.signal);
    }
  } finally {
    clearTimeout(timer);
    removeParentAbort?.();
  }
}

function normalizeConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) {
    return PARKING_DETAIL_CONCURRENCY;
  }
  return Math.min(value, 8);
}

function normalizeMaxResponseBytes(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) {
    return PARKING_MAX_RESPONSE_BYTES;
  }
  return Math.min(value, 8 * 1024 * 1024);
}

function normalizeDetailBudgetMs(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) {
    return PARKING_DETAIL_BUDGET_MS;
  }
  return Math.min(value, 30_000);
}

async function enrichFacilities(
  facilities: ParkingFacility[],
  options: {
    fetcher: typeof globalThis.fetch;
    detailEndpoint: string;
    timeoutMs: number;
    maxResponseBytes: number;
    concurrency: number;
    budgetMs: number;
  },
): Promise<ParkingFacility[]> {
  const result = [...facilities];
  const budgetController = new AbortController();
  const budgetTimer = setTimeout(() => {
    budgetController.abort(new ParkingClientError('timeout'));
  }, options.budgetMs);
  const detailSignal = budgetController.signal;
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      if (detailSignal.aborted) return;
      const index = nextIndex;
      nextIndex += 1;
      if (index >= result.length) return;
      const facility = result[index];
      if (!facility) continue;
      const detailUrl = new URL(`?id=${encodeURIComponent(facility.id)}`, options.detailEndpoint).toString();
      try {
        const detailHtml = await fetchHtml(detailUrl, {
          fetcher: options.fetcher,
          signal: detailSignal,
          timeoutMs: options.timeoutMs,
          maxResponseBytes: options.maxResponseBytes,
        });
        const detail = parseParkingDetailHtml(detailHtml);
        const parsed = ParkingFacilitySchema.safeParse({ ...facility, ...detail });
        if (parsed.success) result[index] = parsed.data;
      } catch {
        if (detailSignal.aborted) return;
        // Static detail is enrichment only. A transient detail failure must not
        // remove the live row or turn a complete realtime response into an error.
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(options.concurrency, result.length) }, () => worker()));
    return result;
  } finally {
    clearTimeout(budgetTimer);
  }
}

function createSourceSnapshotLoader(options: {
  fetcher: typeof globalThis.fetch;
  endpoint: string;
  detailEndpoint: string;
  timeoutMs: number;
  maxResponseBytes: number;
  detailConcurrency: number;
  detailBudgetMs: number;
  now: () => Date;
}): () => Promise<ParkingSourceSnapshot> {
  return async () => {
    const html = await fetchHtml(options.endpoint, {
      fetcher: options.fetcher,
      timeoutMs: options.timeoutMs,
      maxResponseBytes: options.maxResponseBytes,
    });
    let parsed: ParkingFacility[];
    try {
      parsed = parseParkingRealtimeHtml(html);
    } catch (error) {
      if (error instanceof ParkingParseError) {
        throw new ParkingClientError('invalid-html', { cause: error });
      }
      throw error;
    }
    const facilities = await enrichFacilities(parsed, {
      fetcher: options.fetcher,
      detailEndpoint: options.detailEndpoint,
      timeoutMs: options.timeoutMs,
      maxResponseBytes: options.maxResponseBytes,
      concurrency: options.detailConcurrency,
      budgetMs: options.detailBudgetMs,
    });
    return {
      updatedAt: options.now().toISOString(),
      facilities,
    };
  };
}

export function createParkingClient(options: ParkingClientOptions = {}): ParkingClient {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? PARKING_TIMEOUT_MS;
  const maxResponseBytes = normalizeMaxResponseBytes(options.maxResponseBytes);
  const detailConcurrency = normalizeConcurrency(options.detailConcurrency);
  const detailBudgetMs = normalizeDetailBudgetMs(options.detailBudgetMs);
  const cache = options.cache ?? new RealtimeCache<ParkingSourceSnapshot>({
    now: () => now().getTime(),
    freshTtlMs: options.cacheTtlMs ?? PARKING_CACHE_TTL_MS,
  });
  const endpoint = options.endpoint ?? DSAT_PARKING_ENDPOINT;
  const detailEndpoint = options.detailEndpoint ?? DSAT_PARKING_DETAIL_ENDPOINT;

  return {
    async fetchSnapshot(signal?: AbortSignal): Promise<ParkingSnapshot> {
      const sharedResult = cache.get('parking', createSourceSnapshotLoader({
        fetcher,
        endpoint,
        detailEndpoint,
        timeoutMs,
        maxResponseBytes,
        detailConcurrency,
        detailBudgetMs,
        now,
      }));
      const result = await raceWithAbort(sharedResult, signal);
      return ParkingSnapshotSchema.parse({ ...result.value, stale: result.stale });
    },
  };
}
