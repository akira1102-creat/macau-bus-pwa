import { useCallback, useEffect, useRef, useState } from 'react';

import type { ParkingSnapshot } from '../../../shared/parking-contract';
import type { ParkingApiClient } from '../../infra/parking-client';

export type ParkingPollingStatus = 'loading' | 'refreshing' | 'ready' | 'error';

export interface ParkingPollingState {
  status: ParkingPollingStatus;
  data: ParkingSnapshot | null;
  error: unknown;
  refresh: () => void;
}

export interface ParkingPollingOptions {
  intervalMs?: number;
  enabled?: boolean;
}

/** Poll while the visible parking list/map/detail surface is open. */
export function useParkingPolling(client: ParkingApiClient, options: ParkingPollingOptions = {}): ParkingPollingState {
  const intervalMs = options.intervalMs ?? 10_000;
  const enabled = options.enabled ?? true;
  const [status, setStatus] = useState<ParkingPollingStatus>('loading');
  const [data, setData] = useState<ParkingSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const dataRef = useRef<ParkingSnapshot | null>(null);
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
    if (inFlightRef.current || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) {
      return;
    }
    inFlightRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++requestId.current;
    setStatus(dataRef.current ? 'refreshing' : 'loading');
    setError(null);
    try {
      const next = await client.getSnapshot(controller.signal);
      if (request !== requestId.current) {
        return;
      }
      dataRef.current = next;
      setData(next);
      setStatus('ready');
    } catch (nextError) {
      if (request !== requestId.current || controller.signal.aborted) {
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
  }, [client]);

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
      intervalId = window.setInterval(() => void load(), intervalMs);
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
