import type { FastifyInstance } from 'fastify';

export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return reply.code(200).send({ status: 'ok' });
  });
}
