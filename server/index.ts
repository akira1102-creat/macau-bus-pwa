import { fileURLToPath } from 'node:url';

import { buildServer } from './app';

export async function startServer(): Promise<void> {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '127.0.0.1';
  const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
  const catalogPath = process.env.CATALOG_PATH;
  const app = buildServer({
    staticDir: distDirectory,
    ...(catalogPath === undefined ? {} : { catalogPath }),
  });
  await app.listen({ port: Number.isFinite(port) ? port : 3000, host });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer().catch((error: unknown) => {
    console.error('Server failed to start', error);
    process.exitCode = 1;
  });
}
