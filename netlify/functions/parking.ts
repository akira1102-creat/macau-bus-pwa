import type { Config, Context } from '@netlify/functions';

import { ParkingClientError } from '../../server/parking/client';
import { guardParkingApiRequest, parkingJsonResponse } from '../../server/parking/http';
import { getParkingRuntime } from '../../server/parking/runtime';
import { ParkingSnapshotSchema } from '../../shared/parking-contract';

export default async function parkingHandler(request: Request, context: Context): Promise<Response> {
  void context;
  const guarded = guardParkingApiRequest(request);
  if (guarded) return guarded;

  try {
    const snapshot = ParkingSnapshotSchema.parse(await getParkingRuntime().client.fetchSnapshot());
    return parkingJsonResponse(request, snapshot);
  } catch (error) {
    const diagnosticCode = error instanceof ParkingClientError ? error.code : 'unknown';
    console.error(JSON.stringify({ event: 'dsat-parking-failed', code: diagnosticCode }));
    const timeout = error instanceof ParkingClientError && error.code === 'timeout';
    return parkingJsonResponse(
      request,
      { error: timeout ? 'upstream-timeout' : 'upstream-error' },
      timeout ? 504 : 502,
      { 'X-Upstream-Error-Code': diagnosticCode },
    );
  }
}

export const config: Config = {
  path: '/api/parking',
  method: ['GET', 'OPTIONS'],
};
