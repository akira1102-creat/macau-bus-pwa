import { useCallback, useEffect, useRef, useState } from 'react';

import type { DirectionId, RealtimeRouteResponse } from '../../../shared/transit-contract';

export interface RealtimeClientLike {
  getRealtimeRoute: (route: string, direction: DirectionId) => Promise<RealtimeRouteResponse>;
}

export type RealtimePollingStatus = 'loading' | 'refreshing' | 'ready' | 'error';

export interface RealtimePollingState {
  status: RealtimePollingStatus;
  data: RealtimeRouteResponse | null;
  error: unknown;
  refresh: () => void;
}

interface RealtimePollingOptions {
  intervalMs?: number;
  enabled?: boolean;
}

/** Poll only a visible route screen; hidden tabs cancel the interval and refresh on return. */
export function useRealtimePolling(
  route: string,
  direction: DirectionId,
  client: RealtimeClientLike,
  options: RealtimePollingOptions = {},
): RealtimePollingState {
  const intervalMs = options.intervalMs ?? 12_000;
  const enabled = options.enabled ?? true;
  const [status, setStatus] = useState<RealtimePollingStatus>('loading');
  const [data, setData] = useState<RealtimeRouteResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const dataRef = useRef<RealtimeRouteResponse | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setStatus(dataRef.current ? 'refreshing' : 'loading');
    setError(null);
    try {
      const next = await client.getRealtimeRoute(route, direction);
      if (currentRequest !== requestId.current) {
        return;
      }
      dataRef.current = next;
      setData(next);
      setStatus('ready');
    } catch (nextError) {
      if (currentRequest !== requestId.current) {
        return;
      }
      setError(nextError);
      setStatus('error');
    }
  }, [client, direction, route]);

  useEffect(() => {
    requestId.current += 1;
    setStatus('loading');
    dataRef.current = null;
    setData(null);
    setError(null);
  }, [direction, route]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let intervalId: number | undefined;
    const clearPolling = () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };
    const startPolling = () => {
      clearPolling();
      if (document.visibilityState !== 'visible') {
        return;
      }
      void load();
      intervalId = window.setInterval(() => {
        if (document.visibilityState === 'visible') {
          void load();
        }
      }, intervalMs);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        startPolling();
      } else {
        clearPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearPolling();
      requestId.current += 1;
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, intervalMs, load]);

  return { status, data, error, refresh: () => void load() };
}
