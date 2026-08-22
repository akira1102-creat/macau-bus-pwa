import type { Config, Context } from '@netlify/functions';

import { readNetlifyEnv } from './_shared/env';
import { guardApiRequest, jsonResponse, type ApiRequestOptions } from './_shared/http';
import {
  getDefaultPushDependencies,
  type PushApiDependencies,
} from './_shared/push-store';

const PUBLIC_KEY_API_OPTIONS: ApiRequestOptions = {
  methods: ['GET'],
};

export function createPushPublicKeyHandler(
  dependencies: PushApiDependencies = getDefaultPushDependencies(),
): (request: Request, context: Context) => Promise<Response> {
  return async function pushPublicKeyHandler(request: Request, context: Context): Promise<Response> {
    void context;
    const guarded = guardApiRequest(request, PUBLIC_KEY_API_OPTIONS);
    if (guarded) return guarded;

    const publicKey = dependencies.publicKey ?? readNetlifyEnv('VAPID_PUBLIC_KEY');
    if (!publicKey) {
      return jsonResponse(request, { error: 'public-key-unavailable' }, 503, {}, PUBLIC_KEY_API_OPTIONS);
    }
    return jsonResponse(request, { publicKey }, 200, {}, PUBLIC_KEY_API_OPTIONS);
  };
}

export default async function pushPublicKeyDefaultHandler(request: Request, context: Context): Promise<Response> {
  return createPushPublicKeyHandler()(request, context);
}

export const config: Config = {
  path: '/api/push/public-key',
  method: ['GET', 'OPTIONS'],
};
