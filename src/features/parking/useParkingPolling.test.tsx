// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ParkingSnapshot } from '../../../shared/parking-contract';
import type { ParkingApiClient } from '../../infra/parking-client';
import { useParkingPolling } from './useParkingPolling';

const snapshot: ParkingSnapshot = { updatedAt: '2026-08-22T10:00:00+08:00', stale: false, facilities: [] };

function Probe({ client }: { client: ParkingApiClient }) {
  const state = useParkingPolling(client, { intervalMs: 20 });
  return <output data-testid="state">{state.status}:{state.data?.updatedAt ?? 'none'}</output>;
}

describe('useParkingPolling', () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('keeps the last snapshot on transient errors and pauses polling while hidden', async () => {
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce(snapshot)
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue(snapshot);
    const client = { getSnapshot } satisfies ParkingApiClient;
    render(<Probe client={client} />);

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ready:2026-08-22T10:00:00+08:00'));
    expect(screen.getByTestId('state')).toHaveTextContent('ready:2026-08-22T10:00:00+08:00');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    const callsWhileHidden = getSnapshot.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(getSnapshot).toHaveBeenCalledTimes(callsWhileHidden);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(getSnapshot.mock.calls.length).toBeGreaterThan(callsWhileHidden));
    expect(screen.getByTestId('state')).toHaveTextContent('error:2026-08-22T10:00:00+08:00');
  });
});
