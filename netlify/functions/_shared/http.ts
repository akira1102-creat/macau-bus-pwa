export const PRODUCTION_ALLOWED_ORIGIN = 'https://akira1102-creat.github.io';

export type ApiMethod = 'GET' | 'POST' | 'DELETE';

export interface ApiRequestOptions {
  methods?: readonly ApiMethod[];
  allowedHeaders?: readonly string[];
  requireTrustedOrigin?: boolean;
}

function isApiMethodList(
  value: ApiRequestOptions | readonly ApiMethod[] | undefined,
): value is readonly ApiMethod[] {
  return Array.isArray(value);
}

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

function resolveOptions(
  options: ApiRequestOptions | readonly ApiMethod[] | undefined,
): Required<ApiRequestOptions> {
  if (options === undefined || isApiMethodList(options)) {
    return {
      methods: options && options.length > 0 ? [...options] : ['GET'],
      allowedHeaders: ['Accept', 'Content-Type'],
      requireTrustedOrigin: false,
    };
  }
  return {
    methods: options?.methods && options.methods.length > 0 ? [...options.methods] : ['GET'],
    allowedHeaders: options?.allowedHeaders && options.allowedHeaders.length > 0
      ? [...options.allowedHeaders]
      : ['Accept', 'Content-Type'],
    requireTrustedOrigin: options?.requireTrustedOrigin === true,
  };
}

function headersFor(
  request: Request,
  extra: Record<string, string> = {},
  options?: ApiRequestOptions | readonly ApiMethod[],
): Headers {
  const resolved = resolveOptions(options);
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
    headers.set('Access-Control-Allow-Methods', `${resolved.methods.join(', ')}, OPTIONS`);
    headers.set('Access-Control-Allow-Headers', resolved.allowedHeaders.join(', '));
    headers.set('Access-Control-Max-Age', '600');
  }
  return headers;
}

export function jsonResponse(
  request: Request,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
  options?: ApiRequestOptions | readonly ApiMethod[],
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: headersFor(request, extraHeaders, options),
  });
}

/** Returns a response for CORS/method handling, or undefined for a GET. */
export function guardApiRequest(
  request: Request,
  options?: ApiRequestOptions | readonly ApiMethod[],
): Response | undefined {
  const resolved = resolveOptions(options);
  const originHeader = request.headers.get('origin');
  const origin = requestOrigin(request);
  const allowedOrigin = configuredAllowedOrigin();
  if (
    resolved.requireTrustedOrigin
    && request.method !== 'OPTIONS'
    && (originHeader === null || !origin || !allowedOrigin || origin !== allowedOrigin)
  ) {
    return jsonResponse(request, { error: 'cors-not-allowed' }, 403, {}, resolved);
  }
  if (originHeader && (!origin || !allowedOrigin || origin !== allowedOrigin)) {
    return jsonResponse(request, { error: 'cors-not-allowed' }, 403, {}, resolved);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: headersFor(request, {}, resolved),
    });
  }
  if (!resolved.methods.includes(request.method as ApiMethod)) {
    const allow = `${resolved.methods.join(', ')}, OPTIONS`;
    return jsonResponse(request, { error: 'method-not-allowed' }, 405, {
      Allow: allow,
    }, resolved);
  }
  return undefined;
}
