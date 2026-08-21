import type { FastifyInstance } from 'fastify';

export interface HealthRouteOptions {
  catalogReady?: boolean;
}

export function registerHealthRoute(app: FastifyInstance, options: HealthRouteOptions = {}): void {
  app.get('/api/health', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return reply.code(200).send({ status: 'ok', catalogReady: options.catalogReady ?? true });
  });
}
