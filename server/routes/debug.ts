import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { CatalogRepository } from '../../src/data/catalog-repository';
import type { DirectionId } from '../../shared/transit-contract';
import { DsatClientError, type DsatClient } from '../dsat/dsat-client';

interface DebugParams {
  route: string;
  direction: string;
}

export interface RegisterDebugRouteOptions {
  app: FastifyInstance;
  catalog: CatalogRepository;
  client: DsatClient;
}

function parseDirection(value: string): DirectionId | undefined {
  return value === '0' ? 0 : value === '1' ? 1 : undefined;
}

function maskRawValue(value: unknown, key?: string): unknown {
  if (key && /^(busPlate|busCode|plate)$/i.test(key)) {
    return '[MASKED]';
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskRawValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      maskRawValue(entryValue, entryKey),
    ]));
  }
  return value;
}

function sendDebugError(reply: FastifyReply, error: unknown): FastifyReply {
  const timeout = error instanceof DsatClientError && error.code === 'timeout';
  return reply.code(timeout ? 504 : 502).send({ error: timeout ? 'upstream-timeout' : 'upstream-error' });
}

export function registerDebugRoute(options: RegisterDebugRouteOptions): void {
  options.app.get<{ Params: DebugParams }>(
    '/api/debug/dsat/:route/:direction',
    async (request: FastifyRequest<{ Params: DebugParams }>, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');
      const route = request.params.route.trim();
      const direction = parseDirection(request.params.direction);
      if (direction === undefined) {
        return reply.code(400).send({ error: 'invalid-direction' });
      }
      if (!options.catalog.getRoute(route)) {
        return reply.code(404).send({ error: 'route-not-allowlisted' });
      }
      try {
        const response = await options.client.fetchRoute(route, direction);
        return reply.code(200).send({
          route,
          direction,
          buses: response.buses.map((bus) => ({ ...bus, plate: '[MASKED]' })),
          raw: maskRawValue(response.raw),
        });
      } catch (error) {
        return sendDebugError(reply, error);
      }
    },
  );
}
