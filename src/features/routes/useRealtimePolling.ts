import { useCallback, useEffect, useRef, useState } from 'react';

import type { DirectionId, RealtimeRouteResponse } from '../../../shared/transit-contract';

export interface RealtimeClientLike {
  getRealtimeRoute: (route: string, direction: DirectionId, signal?: AbortSignal) => Promise<RealtimeRouteResponse>;
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
  const controllerRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);

  const abortInFlight = useCallback(() => {
    requestId.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    inFlightRef.current = false;
  }, []);

  const load = useCallback(async () => {
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    const currentRequest = ++requestId.current;
    setStatus(dataRef.current ? 'refreshing' : 'loading');
    setError(null);
    try {
      const next = await client.getRealtimeRoute(route, direction, controller.signal);
      if (currentRequest !== requestId.current) {
        return;
      }
      dataRef.current = next;
      setData(next);
      setStatus('ready');
    } catch (nextError) {
      if (currentRequest !== requestId.current || controller.signal.aborted) {
        return;
      }
      setError(nextError);
      setStatus('error');
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        inFlightRef.current = false;
      }
    }
  }, [client, direction, route]);

  useEffect(() => {
    abortInFlight();
    setStatus('loading');
    dataRef.current = null;
    setData(null);
    setError(null);
  }, [abortInFlight, direction, route]);

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
        abortInFlight();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearPolling();
      abortInFlight();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [abortInFlight, enabled, intervalMs, load]);

  return { status, data, error, refresh: () => void load() };
}
