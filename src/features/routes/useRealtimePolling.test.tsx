// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RealtimeRouteResponse } from '../../../shared/transit-contract';
import { useRealtimePolling } from './useRealtimePolling';

function pendingResponse(): Promise<RealtimeRouteResponse> {
  return new Promise<RealtimeRouteResponse>(() => undefined);
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
}

describe('useRealtimePolling', () => {
  afterEach(() => {
    setVisibility('visible');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('aborts an in-flight request on hidden, route/direction changes and unmount', () => {
    setVisibility('visible');
    const requests: AbortSignal[] = [];
    const client = {
      getRealtimeRoute: vi.fn((_route: string, _direction: 0 | 1, signal?: AbortSignal) => {
        requests.push(signal!);
        return pendingResponse();
      }),
    };
    const initialProps: { route: string; direction: 0 | 1 } = { route: '1', direction: 0 };
    const { rerender, unmount } = renderHook(
      ({ route, direction }: { route: string; direction: 0 | 1 }) => useRealtimePolling(route, direction, client),
      { initialProps },
    );

    expect(requests).toHaveLength(1);
    const firstSignal = requests[0]!;
    act(() => {
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(firstSignal.aborted).toBe(true);

    act(() => {
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(requests).toHaveLength(2);
    const secondSignal = requests[1]!;

    rerender({ route: '1', direction: 1 });
    expect(secondSignal.aborted).toBe(true);
    expect(requests).toHaveLength(3);
    const thirdSignal = requests[2]!;
    rerender({ route: '2', direction: 1 });
    expect(thirdSignal.aborted).toBe(true);
    expect(requests).toHaveLength(4);

    const latestSignal = requests[3]!;
    unmount();
    expect(latestSignal.aborted).toBe(true);
  });

  it('does not start an overlapping request while the previous poll is pending', () => {
    vi.useFakeTimers();
    setVisibility('visible');
    const client = { getRealtimeRoute: vi.fn(() => pendingResponse()) };
    renderHook(() => useRealtimePolling('1', 0, client, { intervalMs: 10 }));

    expect(client.getRealtimeRoute).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(client.getRealtimeRoute).toHaveBeenCalledTimes(1);
  });
});
