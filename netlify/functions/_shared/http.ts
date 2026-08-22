export const PRODUCTION_ALLOWED_ORIGIN = 'https://akira1102-creat.github.io';

function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:')
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function configuredAllowedOrigin(): string | undefined {
  return PRODUCTION_ALLOWED_ORIGIN;
}

function requestOrigin(request: Request): string | undefined {
  const rawOrigin = request.headers.get('origin');
  if (!rawOrigin) {
    return undefined;
  }
  return normalizeOrigin(rawOrigin);
}

function headersFor(request: Request, extra: Record<string, string> = {}): Headers {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
    ...extra,
  });
  const origin = requestOrigin(request);
  const allowedOrigin = configuredAllowedOrigin();
  if (origin && allowedOrigin && origin === allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin);
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Accept, Content-Type');
    headers.set('Access-Control-Max-Age', '600');
  }
  return headers;
}

export function jsonResponse(
  request: Request,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: headersFor(request, extraHeaders),
  });
}

/** Returns a response for CORS/method handling, or undefined for a GET. */
export function guardApiRequest(request: Request): Response | undefined {
  const originHeader = request.headers.get('origin');
  const origin = requestOrigin(request);
  const allowedOrigin = configuredAllowedOrigin();
  if (originHeader && (!origin || !allowedOrigin || origin !== allowedOrigin)) {
    return jsonResponse(request, { error: 'cors-not-allowed' }, 403);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: headersFor(request),
    });
  }
  if (request.method !== 'GET') {
    return jsonResponse(request, { error: 'method-not-allowed' }, 405, {
      Allow: 'GET, OPTIONS',
    });
  }
  return undefined;
}
