export const PARKING_PRODUCTION_ORIGIN = 'https://akira1102-creat.github.io';
export const PARKING_DEVELOPMENT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
] as const;

const PARKING_ALLOWED_ORIGINS = new Set<string>([
  PARKING_PRODUCTION_ORIGIN,
  ...PARKING_DEVELOPMENT_ORIGINS,
]);

function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
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

export function isAllowedParkingOrigin(value: string | undefined): boolean {
  const normalized = normalizeOrigin(value);
  return normalized !== undefined && PARKING_ALLOWED_ORIGINS.has(normalized);
}

export function parkingCorsHeaders(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
  const normalized = normalizeOrigin(origin);
  if (normalized && PARKING_ALLOWED_ORIGINS.has(normalized)) {
    headers['Access-Control-Allow-Origin'] = normalized;
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Accept, Content-Type';
    headers['Access-Control-Max-Age'] = '600';
  }
  return headers;
}

export function parkingJsonResponse(
  request: Request,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  const origin = request.headers.get('origin') ?? undefined;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...parkingCorsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

/** Returns a response for parking CORS/method handling, or undefined for GET. */
export function guardParkingApiRequest(request: Request): Response | undefined {
  const originHeader = request.headers.get('origin');
  if (originHeader !== null && !isAllowedParkingOrigin(originHeader)) {
    return parkingJsonResponse(request, { error: 'cors-not-allowed' }, 403);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: parkingCorsHeaders(originHeader ?? undefined),
    });
  }
  if (request.method !== 'GET') {
    return parkingJsonResponse(request, { error: 'method-not-allowed' }, 405, {
      Allow: 'GET, OPTIONS',
    });
  }
  return undefined;
}
