import { useEffect, useState } from 'react';
import { z } from 'zod';

import { DirectionIdSchema, RealtimeBusSchema, type DirectionId, type RealtimeRouteResponse } from '../../../shared/transit-contract';
import './dev-debug.css';

const DevDebugResponseSchema = z.object({
  route: z.string().trim().min(1),
  direction: DirectionIdSchema,
  buses: z.array(RealtimeBusSchema),
  raw: z.unknown(),
});

export type DevDebugResponse = z.infer<typeof DevDebugResponseSchema>;

export async function fetchDevDebugRoute(
  route: string,
  direction: DirectionId,
  signal?: AbortSignal,
): Promise<DevDebugResponse> {
  const normalizedRoute = route.trim();
  const response = await fetch(`/api/debug/dsat/${encodeURIComponent(normalizedRoute)}/${direction}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    throw new Error(`development debug request failed: ${response.status}`);
  }
  return DevDebugResponseSchema.parse(await response.json());
}

function maskIdentifier(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return '—';
  }
  if (normalized.length <= 2) {
    return '••';
  }
  return `${normalized.slice(0, 1)}••${normalized.slice(-1)}`;
}

interface DevDebugPanelProps {
  routeId: string;
  directionId: DirectionId;
  data: RealtimeRouteResponse;
}

export default function DevDebugPanel({ routeId, directionId, data }: DevDebugPanelProps) {
  const [debugData, setDebugData] = useState<DevDebugResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void fetchDevDebugRoute(routeId, directionId, controller.signal)
      .then((next) => {
        if (active) {
          setDebugData(next);
        }
      })
      .catch(() => {
        // The normalized realtime panel remains usable if the debug endpoint is unavailable.
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [directionId, routeId]);

  const displayData = debugData ?? {
    route: data.route,
    direction: data.direction,
    buses: data.buses,
    raw: null,
  };

  return (
    <details className="debug-panel">
      <summary>開發診斷</summary>
      <dl>
        <dt>route</dt><dd>{displayData.route}</dd>
        <dt>direction</dt><dd>{displayData.direction}</dd>
        <dt>最近觀測</dt><dd>{data.updatedAt}</dd>
        {displayData.buses.map((bus, index) => (
          <div className="debug-bus" key={`${bus.plate}-${index}`}>
            <dt>plate</dt><dd>{debugData ? bus.plate : maskIdentifier(bus.plate)}</dd>
            <dt>staCode</dt><dd>{debugData ? bus.stationCode : maskIdentifier(bus.stationCode)}</dd>
            <dt>speed</dt><dd>{bus.speedKph ?? '—'}</dd>
            <dt>status</dt><dd>{bus.status ?? '—'}</dd>
          </div>
        ))}
        {debugData ? <><dt>raw response</dt><dd><code>{JSON.stringify(debugData.raw) ?? '—'}</code></dd></> : null}
      </dl>
    </details>
  );
}
