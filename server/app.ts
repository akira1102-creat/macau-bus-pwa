import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';

import type { CatalogRepository } from '../src/data/catalog-repository';
import { createCatalogRepository } from '../src/data/catalog-repository';
import type { RealtimeRouteResponse, TransitCatalog } from '../shared/transit-contract';
import { TransitCatalogSchema } from '../shared/transit-contract';
import {
  isDevelopmentEnvironment,
  resolveServerConfig,
  type ServerConfigOverrides,
} from './config';
import { RealtimeCache } from './cache/realtime-cache';
import { createDsatClient, type DsatClient } from './dsat/dsat-client';
import { registerDebugRoute } from './routes/debug';
import { registerHealthRoute } from './routes/health';
import { registerRealtimeRoutes, RealtimeRateLimiter } from './routes/realtime';

export interface BuildServerOptions extends ServerConfigOverrides {
  catalog?: TransitCatalog;
  catalogRepository?: CatalogRepository;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  client?: DsatClient;
  cache?: RealtimeCache<RealtimeRouteResponse>;
  logger?: boolean;
}

function loadDefaultCatalog(): TransitCatalog {
  const catalogPath = fileURLToPath(new URL('../public/data/catalog.json', import.meta.url));
  const raw = JSON.parse(readFileSync(catalogPath, 'utf8')) as unknown;
  return TransitCatalogSchema.parse(raw);
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const config = resolveServerConfig(options);
  const catalogRepository = options.catalogRepository
    ?? createCatalogRepository(options.catalog ?? loadDefaultCatalog());
  const now = options.now ?? (() => new Date());
  const client = options.client ?? createDsatClient({
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    timeoutMs: config.dsatTimeoutMs,
    endpoint: config.dsatEndpoint,
    origin: config.dsatOrigin,
    referer: config.dsatReferer,
    maxResponseBytes: config.dsatMaxResponseBytes,
    now,
  });
  const cache = options.cache ?? new RealtimeCache<RealtimeRouteResponse>({
    now: () => now().getTime(),
    freshTtlMs: config.realtimeFreshTtlMs,
  });
  const rateLimiter = new RealtimeRateLimiter({
    now: () => now().getTime(),
    windowMs: config.rateLimitWindowMs,
    maxRequests: config.rateLimitMaxRequests,
    maxTrackedKeys: config.rateLimitMaxTrackedKeys,
  });
  const app = Fastify({ logger: options.logger ?? false });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
    }
    return reply.code(404).send({ error: 'not-found' });
  });

  registerHealthRoute(app);
  registerRealtimeRoutes({ app, catalog: catalogRepository, client, cache, now, rateLimiter });
  if (config.environment === 'development' && isDevelopmentEnvironment()) {
    registerDebugRoute({ app, catalog: catalogRepository, client });
  }
  return app;
}
