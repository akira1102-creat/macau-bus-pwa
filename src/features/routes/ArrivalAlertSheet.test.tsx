// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import fixture from '../../../tests/fixtures/catalog/catalog.json';
import type { RouteSummary, TransitCatalog } from '../../../shared/transit-contract';
import type { PushClient } from '../../infra/push-client';
import { ArrivalAlertSheet } from './ArrivalAlertSheet';

const catalog = fixture as TransitCatalog;
const route = catalog.routes[0] as RouteSummary;
const direction = route.directions[0]!;
const stop = catalog.stops.find((candidate) => candidate.id === 'M2')!;

function pushClient(overrides: Partial<PushClient> = {}): PushClient {
  return {
    support: () => ({ supported: true, permission: 'granted' }),
    listAlerts: vi.fn().mockResolvedValue([]),
    createAlert: vi.fn().mockResolvedValue({
      id: 'alert-1',
      routeId: route.id,
      direction: direction.id,
      targetStopId: stop.id,
      targetStopIndex: 1,
      threshold: 3,
    }),
    deleteAlert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('ArrivalAlertSheet', () => {
  it('shows the default lead count and creates a one-shot reminder', async () => {
    const client = pushClient();
    render(<ArrivalAlertSheet route={route} direction={direction} stop={stop} targetStopIndex={1} leadStops={3} pushClient={client} onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: '設定到站提醒' })).toBeVisible();
    expect(screen.getByText('提前 3 站')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '設定一次性提醒' }));

    await waitFor(() => expect(client.createAlert).toHaveBeenCalledWith({
      routeId: '1', direction: 0, targetStopId: 'M2', targetStopIndex: 1, threshold: 3,
    }));
    expect(await screen.findByText('提醒已設定：提前 3 站')).toBeVisible();
  });

  it('prefetches push setup on mount without replacing the explicit confirmation action', async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);
    const client = pushClient({ prepare });
    render(<ArrivalAlertSheet route={route} direction={direction} stop={stop} targetStopIndex={1} leadStops={3} pushClient={client} onClose={vi.fn()} />);

    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    expect(client.createAlert).not.toHaveBeenCalled();
  });

  it('lists an active reminder and allows it to be cancelled', async () => {
    const deleteAlert = vi.fn().mockResolvedValue(undefined);
    const client = pushClient({
      listAlerts: vi.fn().mockResolvedValue([{
        id: 'alert-existing', routeId: '1', direction: 0, targetStopId: 'M2', targetStopIndex: 1, threshold: 2,
      }]),
      deleteAlert,
    });
    render(<ArrivalAlertSheet route={route} direction={direction} stop={stop} targetStopIndex={1} leadStops={3} pushClient={client} onClose={vi.fn()} />);

    expect(await screen.findByText('現有提醒：提前 2 站')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '取消提醒' }));

    await waitFor(() => expect(deleteAlert).toHaveBeenCalledWith('alert-existing'));
    expect(await screen.findByText('提醒已取消')).toBeVisible();
  });

  it('does not match an active reminder from another repeated stop occurrence', async () => {
    const repeatedDirection = { ...direction, stopIds: [stop.id, 'M1', stop.id] };
    const client = pushClient({
      listAlerts: vi.fn().mockResolvedValue([{
        id: 'alert-other-occurrence', routeId: route.id, direction: direction.id, targetStopId: stop.id, targetStopIndex: 0, threshold: 2,
      }]),
    });

    render(<ArrivalAlertSheet route={route} direction={repeatedDirection} stop={stop} targetStopIndex={2} leadStops={3} pushClient={client} onClose={vi.fn()} />);

    expect(await screen.findByRole('button', { name: '設定一次性提醒' })).toBeVisible();
    expect(screen.queryByText('現有提醒：提前 2 站')).not.toBeInTheDocument();
  });

  it('explains unsupported push instead of creating a local-only reminder', async () => {
    const client = pushClient({ support: () => ({ supported: false, permission: 'unsupported', reason: 'push-unavailable' }) });
    render(<ArrivalAlertSheet route={route} direction={direction} stop={stop} targetStopIndex={1} leadStops={3} pushClient={client} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '設定一次性提醒' }));
    expect(await screen.findByText(/此裝置未支援背景到站提醒/)).toBeVisible();
    expect(client.createAlert).not.toHaveBeenCalled();
  });

  it('explains the iOS and iPadOS home-screen requirement', () => {
    const client = pushClient({ support: () => ({ supported: false, permission: 'default', reason: 'ios-not-standalone' }) });
    render(<ArrivalAlertSheet route={route} direction={direction} stop={stop} targetStopIndex={1} leadStops={3} pushClient={client} onClose={vi.fn()} />);

    expect(screen.getByText('iOS/iPadOS 需先將 PWA 加入主畫面，然後從主畫面開啟提醒功能。')).toBeVisible();
  });
});
