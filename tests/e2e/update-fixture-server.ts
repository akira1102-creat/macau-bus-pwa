import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function fixtureWorker(release: string): string {
  return `const UPDATE_FIXTURE_RELEASE = ${JSON.stringify(release)};
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
`;
}

export interface UpdateFixtureServer {
  readonly url: string;
  setWorkerRelease(release: string): Promise<void>;
  close(): Promise<void>;
}

export async function createUpdateFixtureServer(): Promise<UpdateFixtureServer> {
  const distDirectory = resolve(process.cwd(), 'dist');
  let workerRelease = 'fixture-v1';
  const server: Server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname === '/sw.js') {
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/javascript; charset=utf-8',
      });
      response.end(fixtureWorker(workerRelease));
      return;
    }

    const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const filePath = resolve(distDirectory, relativePath);
    const safeRelativePath = relative(distDirectory, filePath);
    if (safeRelativePath.startsWith('..') || safeRelativePath.includes(':')) {
      response.writeHead(404).end();
      return;
    }

    try {
      const body = readFileSync(filePath);
      response.writeHead(200, {
        'Cache-Control': pathname === '/' || pathname === '/index.html' ? 'no-store' : 'public, max-age=0',
        'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    throw new Error('update fixture server did not expose a port');
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    async setWorkerRelease(release: string): Promise<void> {
      workerRelease = release;
    },
    close: () => new Promise<void>((resolvePromise, reject) => {
      server.close((error) => error ? reject(error) : resolvePromise());
    }),
  };
}
