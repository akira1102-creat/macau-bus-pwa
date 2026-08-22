import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { ParkingSnapshotSchema } from '../../shared/parking-contract';
import {
  isAllowedParkingOrigin,
  parkingCorsHeaders,
} from '../parking/http';
import { ParkingClientError, type ParkingClient } from '../parking/client';

export interface RegisterParkingRoutesOptions {
  app: FastifyInstance;
  client: ParkingClient;
}

function originFromRequest(request: FastifyRequest): string | undefined {
  const origin = request.headers.origin;
  return typeof origin === 'string' ? origin : undefined;
}

function setCorsHeaders(request: FastifyRequest, reply: FastifyReply): boolean {
  const rawOrigin = originFromRequest(request);
  if (rawOrigin !== undefined && !isAllowedParkingOrigin(rawOrigin)) {
    reply.header('Cache-Control', 'no-store');
    reply.header('Vary', 'Origin');
    return false;
  }
  for (const [key, value] of Object.entries(parkingCorsHeaders(rawOrigin))) {
    reply.header(key, value);
  }
  return true;
}

function upstreamError(error: unknown): { statusCode: number; code: string } {
  if (error instanceof ParkingClientError && error.code === 'timeout') {
    return { statusCode: 504, code: 'upstream-timeout' };
  }
  return { statusCode: 502, code: 'upstream-error' };
}

export function registerParkingRoutes(options: RegisterParkingRoutesOptions): void {
  options.app.all('/api/parking', async (request, reply) => {
    if (!setCorsHeaders(request, reply)) {
      return reply.code(403).send({ error: 'cors-not-allowed' });
    }
    if (request.method === 'OPTIONS') {
      return reply.code(204).send();
    }
    if (request.method !== 'GET') {
      return reply.code(405).header('Allow', 'GET, OPTIONS').send({ error: 'method-not-allowed' });
    }

    try {
      const body = ParkingSnapshotSchema.parse(await options.client.fetchSnapshot());
      return reply.code(200).send(body);
    } catch (error) {
      const mapped = upstreamError(error);
      return reply.code(mapped.statusCode)
        .header('X-Upstream-Error-Code', error instanceof ParkingClientError ? error.code : 'unknown')
        .send({ error: mapped.code });
    }
  });
}
