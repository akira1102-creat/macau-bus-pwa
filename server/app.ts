import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';

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
  staticDir?: string;
}

function loadDefaultCatalog(): TransitCatalog {
  const catalogPath = fileURLToPath(new URL('../public/data/catalog.json', import.meta.url));
  const raw = JSON.parse(readFileSync(catalogPath, 'utf8')) as unknown;
  return TransitCatalogSchema.parse(raw);
}

const SHELL_CACHE_CONTROL = 'no-cache, no-store, must-revalidate';

function sendShell(staticDir: string, reply: FastifyReply): FastifyReply {
  try {
    const shell = readFileSync(join(staticDir, 'index.html'), 'utf8');
    return reply.type('text/html; charset=utf-8').code(200).send(shell);
  } catch {
    return reply.code(404).send({ error: 'not-found' });
  }
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

  if (options.staticDir) {
    app.get('/', (_request, reply) => {
      reply.header('Cache-Control', SHELL_CACHE_CONTROL);
      return sendShell(options.staticDir!, reply);
    });
    app.get('/index.html', (_request, reply) => {
      reply.header('Cache-Control', SHELL_CACHE_CONTROL);
      return sendShell(options.staticDir!, reply);
    });
    app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
      index: false,
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
      return reply.code(404).send({ error: 'not-found' });
    }
    if (options.staticDir) {
      if (!extname(pathname)) {
        reply.header('Cache-Control', SHELL_CACHE_CONTROL);
        return sendShell(options.staticDir, reply);
      }
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
