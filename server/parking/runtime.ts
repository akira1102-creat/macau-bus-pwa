import {
  createParkingClient,
  DSAT_PARKING_DETAIL_ENDPOINT,
  DSAT_PARKING_ENDPOINT,
  PARKING_CACHE_TTL_MS,
  PARKING_MAX_RESPONSE_BYTES,
  PARKING_TIMEOUT_MS,
  type ParkingClient,
} from './client';

export interface ParkingRuntime {
  client: ParkingClient;
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
    runtimeState = {
      client: createParkingClient({
        endpoint,
        detailEndpoint,
        timeoutMs: positiveInteger('DSAT_PARKING_TIMEOUT_MS', PARKING_TIMEOUT_MS),
        maxResponseBytes: positiveInteger('DSAT_PARKING_MAX_RESPONSE_BYTES', PARKING_MAX_RESPONSE_BYTES),
        cacheTtlMs: positiveInteger('DSAT_PARKING_CACHE_TTL_MS', PARKING_CACHE_TTL_MS),
      }),
    };
  }
  return runtimeState;
}

export function resetParkingRuntimeForTests(): void {
  runtimeState = undefined;
}
