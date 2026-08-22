import type { Config, Context } from '@netlify/functions';

import { getCatalogRepository } from './_shared/catalog';
import { guardApiRequest, jsonResponse } from './_shared/http';

export default async function healthHandler(request: Request, context: Context): Promise<Response> {
  void context;
  const guarded = guardApiRequest(request);
  if (guarded) {
    return guarded;
  }
  const catalog = await getCatalogRepository();
  return jsonResponse(request, { status: 'ok', catalogReady: Boolean(catalog) });
}

export const config: Config = {
  path: '/api/health',
  method: ['GET', 'OPTIONS'],
};
