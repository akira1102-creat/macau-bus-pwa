import {
  createParkingClient,
  DSAT_PARKING_DETAIL_ENDPOINT,
  DSAT_PARKING_ENDPOINT,
  PARKING_CACHE_TTL_MS,
  PARKING_MAX_RESPONSE_BYTES,
  PARKING_TIMEOUT_MS,
  ParkingClientError,
  type ParkingClient,
} from './client';
import type { ParkingSnapshot } from '../../shared/parking-contract';

export const PARKING_REFRESH_COOLDOWN_MS = 5_000;
type ParkingAdmissionFailureCode = 'error' | 'timeout';

export class ParkingAdmissionError extends Error {
  readonly code = 'rate-limit-exceeded' as const;
  readonly retryAfterSeconds: number;
  readonly failureCode: ParkingAdmissionFailureCode;

  constructor(retryAfterMs: number, failureCode: ParkingAdmissionFailureCode = 'error') {
    super('Parking refresh admission limit exceeded');
    this.name = 'ParkingAdmissionError';
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1_000));
    this.failureCode = failureCode;
  }
}

export interface ParkingRefreshAdmissionOptions {
  now?: () => number;
  cooldownMs?: number;
}

export class ParkingRefreshAdmission {
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private nextAllowedAt = 0;
  private pending: Promise<ParkingSnapshot> | undefined;
  private lastSnapshot: ParkingSnapshot | undefined;
  private lastFailureCode: ParkingAdmissionFailureCode = 'error';

  constructor(options: ParkingRefreshAdmissionOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.cooldownMs = Number.isSafeInteger(options.cooldownMs)
      && (options.cooldownMs ?? 0) > 0
      ? options.cooldownMs!
      : PARKING_REFRESH_COOLDOWN_MS;
  }

  fetch(loader: () => Promise<ParkingSnapshot>): Promise<ParkingSnapshot> {
    if (this.pending) return this.pending;
    const currentTime = this.now();
    if (currentTime < this.nextAllowedAt) {
      if (this.lastSnapshot) {
        return Promise.resolve({ ...this.lastSnapshot, stale: true });
      }
      return Promise.reject(new ParkingAdmissionError(this.nextAllowedAt - currentTime, this.lastFailureCode));
    }

    this.nextAllowedAt = currentTime + this.cooldownMs;
    const pending = Promise.resolve()
      .then(loader)
      .then((snapshot) => {
        this.lastFailureCode = 'error';
        if (!snapshot.stale) this.lastSnapshot = snapshot;
        else if (!this.lastSnapshot) this.lastSnapshot = snapshot;
        return snapshot;
      })
      .catch((error: unknown) => {
        this.lastFailureCode = error instanceof ParkingClientError && error.code === 'timeout'
          ? 'timeout'
          : 'error';
        throw error;
      })
      .finally(() => {
        if (this.pending === pending) this.pending = undefined;
      });
    this.pending = pending;
    return pending;
  }
}

export interface ParkingRuntime {
  client: ParkingClient;
  admission: ParkingRefreshAdmission;
  fetchSnapshot(): Promise<ParkingSnapshot>;
}

let runtimeState: ParkingRuntime | undefined;

function runtimeEnvironment(): { get(name: string): string | undefined } | undefined {
  return (globalThis as typeof globalThis & {
    Netlify?: { env?: { get(name: string): string | undefined } };
  }).Netlify?.env;
}

function readEnvironment(name: string): string | undefined {
  try {
    const fromNetlify = runtimeEnvironment()?.get(name);
    if (typeof fromNetlify === 'string' && fromNetlify.trim()) return fromNetlify.trim();
  } catch {
    // Fall through to process.env when the Netlify runtime is unavailable.
  }
  const fromProcess = process.env[name];
  return typeof fromProcess === 'string' && fromProcess.trim() ? fromProcess.trim() : undefined;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = readEnvironment(name);
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getParkingRuntime(): ParkingRuntime {
  if (!runtimeState) {
    const endpoint = readEnvironment('DSAT_PARKING_ENDPOINT') ?? DSAT_PARKING_ENDPOINT;
    const detailEndpoint = readEnvironment('DSAT_PARKING_DETAIL_ENDPOINT') ?? DSAT_PARKING_DETAIL_ENDPOINT;
    const client = createParkingClient({
      endpoint,
      detailEndpoint,
      timeoutMs: positiveInteger('DSAT_PARKING_TIMEOUT_MS', PARKING_TIMEOUT_MS),
      maxResponseBytes: positiveInteger('DSAT_PARKING_MAX_RESPONSE_BYTES', PARKING_MAX_RESPONSE_BYTES),
      cacheTtlMs: positiveInteger('DSAT_PARKING_CACHE_TTL_MS', PARKING_CACHE_TTL_MS),
    });
    const admission = new ParkingRefreshAdmission({
      cooldownMs: positiveInteger('DSAT_PARKING_REFRESH_COOLDOWN_MS', PARKING_REFRESH_COOLDOWN_MS),
    });
    runtimeState = {
      client,
      admission,
      fetchSnapshot: () => admission.fetch(() => client.fetchSnapshot()),
    };
  }
  return runtimeState;
}

export function resetParkingRuntimeForTests(): void {
  runtimeState = undefined;
}
