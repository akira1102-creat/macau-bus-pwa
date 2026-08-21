export const DSAT_ENDPOINT = 'https://bis.dsat.gov.mo:37812/macauweb/routestation/bus';
export const DSAT_REFERER = 'https://bis.dsat.gov.mo:37812/macauweb/';
export const DSAT_ORIGIN = 'https://bis.dsat.gov.mo:37812';
export const DSAT_TIMEOUT_MS = 4_000;
export const DSAT_MAX_RESPONSE_BYTES = 1_048_576;
export const REALTIME_FRESH_TTL_MS = 12_000;
export const REALTIME_RATE_LIMIT_WINDOW_MS = 60_000;
export const REALTIME_RATE_LIMIT_MAX_REQUESTS = 60;
export const REALTIME_RATE_LIMIT_MAX_TRACKED_KEYS = 1_000;

export type ServerEnvironment = 'development' | 'production' | 'test';

export interface ServerConfig {
  environment: ServerEnvironment;
  dsatEndpoint: string;
  dsatReferer: string;
  dsatOrigin: string;
  dsatTimeoutMs: number;
  dsatMaxResponseBytes: number;
  realtimeFreshTtlMs: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  rateLimitMaxTrackedKeys: number;
}

export interface ServerConfigOverrides {
  environment?: ServerEnvironment;
  env?: ServerEnvironment;
  dsatEndpoint?: string;
  dsatReferer?: string;
  dsatOrigin?: string;
  dsatTimeoutMs?: number;
  dsatMaxResponseBytes?: number;
  realtimeFreshTtlMs?: number;
  rateLimitWindowMs?: number;
  rateLimitMaxRequests?: number;
  rateLimitMaxTrackedKeys?: number;
}

function environmentFromNode(): ServerEnvironment {
  const value = process.env.NODE_ENV;
  if (value === 'development' || value === 'production' || value === 'test') {
    return value;
  }
  return 'production';
}

function normalizeEnvironment(value: unknown): ServerEnvironment | undefined {
  return value === 'development' || value === 'production' || value === 'test'
    ? value
    : undefined;
}

export function resolveServerConfig(overrides: ServerConfigOverrides = {}): ServerConfig {
  const environmentOverride = overrides.environment ?? overrides.env;
  const explicitEnvironment = environmentOverride === undefined
    ? environmentFromNode()
    : normalizeEnvironment(environmentOverride) ?? 'production';
  return {
    environment: explicitEnvironment,
    dsatEndpoint: overrides.dsatEndpoint ?? DSAT_ENDPOINT,
    dsatReferer: overrides.dsatReferer ?? DSAT_REFERER,
    dsatOrigin: overrides.dsatOrigin ?? DSAT_ORIGIN,
    dsatTimeoutMs: overrides.dsatTimeoutMs ?? DSAT_TIMEOUT_MS,
    dsatMaxResponseBytes: overrides.dsatMaxResponseBytes ?? DSAT_MAX_RESPONSE_BYTES,
    realtimeFreshTtlMs: overrides.realtimeFreshTtlMs ?? REALTIME_FRESH_TTL_MS,
    rateLimitWindowMs: overrides.rateLimitWindowMs ?? REALTIME_RATE_LIMIT_WINDOW_MS,
    rateLimitMaxRequests: overrides.rateLimitMaxRequests ?? REALTIME_RATE_LIMIT_MAX_REQUESTS,
    rateLimitMaxTrackedKeys: overrides.rateLimitMaxTrackedKeys ?? REALTIME_RATE_LIMIT_MAX_TRACKED_KEYS,
  };
}

export function isDevelopmentEnvironment(): boolean {
  return process.env.NODE_ENV === 'development';
}
