import type { RealtimeBus } from '../../shared/transit-contract';
import { z } from 'zod';

export type DsatParseErrorCode = 'invalid-payload' | 'invalid-json' | 'application-header';

export class DsatParseError extends Error {
  readonly code: DsatParseErrorCode;
  readonly applicationHeader: string | undefined;

  constructor(code: DsatParseErrorCode, message: string, applicationHeader?: string) {
    super(message);
    this.name = 'DsatParseError';
    this.code = code;
    this.applicationHeader = applicationHeader;
  }
}

export interface ParsedDsatRouteResponse {
  applicationHeader: '000';
  buses: RealtimeBus[];
}

const DsatResponseEnvelopeSchema = z.object({
  header: z.unknown(),
  data: z.object({
    routeInfo: z.array(z.unknown()).optional(),
  }).passthrough().optional(),
}).passthrough();

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function optionalString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function speedKph(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function stationCode(value: unknown): string | null {
  return optionalString(value);
}

export function parseDsatRouteResponse(raw: unknown): ParsedDsatRouteResponse {
  let payload: unknown = raw;
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      throw new DsatParseError('invalid-json', 'DSAT response is not valid JSON');
    }
  }
  const envelope = DsatResponseEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new DsatParseError('invalid-payload', 'DSAT response must be an object');
  }
  const root = envelope.data;
  const header = root.header;
  if (header !== '000') {
    const safeHeader = typeof header === 'string' ? header : 'unknown';
    throw new DsatParseError('application-header', 'DSAT application header is not 000', safeHeader);
  }

  const routeInfo = root.data?.routeInfo ?? [];
  const buses: RealtimeBus[] = [];
  for (const stationValue of routeInfo) {
    const station = asRecord(stationValue);
    const code = stationCode(station?.staCode);
    if (!station || !code) {
      continue;
    }
    const busInfo = Array.isArray(station.busInfo) ? station.busInfo : [];
    for (const busValue of busInfo) {
      const bus = asRecord(busValue);
      if (!bus) {
        continue;
      }
      buses.push({
        plate: optionalString(bus.busPlate) ?? optionalString(bus.busCode) ?? '',
        stationCode: code,
        speedKph: speedKph(bus.speed),
        status: optionalString(bus.status),
        passengerFlow: optionalString(bus.passengerFlow),
        busType: optionalString(bus.busType),
        facilities: optionalString(bus.isFacilities),
      });
    }
  }
  return { applicationHeader: '000', buses };
}
