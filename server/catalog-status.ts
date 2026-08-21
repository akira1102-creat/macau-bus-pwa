import type { FastifyReply } from 'fastify';

export interface CatalogStatus {
  ready: boolean;
}

export const CATALOG_UNAVAILABLE_BODY = {
  error: 'catalog-unavailable',
  action: 'data:sync',
  message: 'Catalog data is unavailable. Run npm run data:sync.',
} as const;

export function sendCatalogUnavailable(reply: FastifyReply): FastifyReply {
  reply.header('Cache-Control', 'no-store');
  return reply.code(503).send(CATALOG_UNAVAILABLE_BODY);
}
