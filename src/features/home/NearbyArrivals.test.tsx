// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import fixture from '../../../tests/fixtures/catalog/catalog.json';
import { createCatalogRepository } from '../../data/catalog-repository';
import type { NearbyStop } from '../../domain/nearby';
import type { ArrivalResult, ArrivalsClient, ArrivalsResponse } from '../../infra/arrivals-client';
import type { TransitCatalog } from '../../../shared/transit-contract';
import { NearbyArrivals } from './NearbyArrivals';

const catalog = fixture as TransitCatalog;
const repository = createCatalogRepository(catalog);

function response(arrivals: ArrivalResult[]): ArrivalsResponse {
  return { updatedAt: '2026-08-22T00:00:00.000Z', arrivals };
}

function nearbyStops(): NearbyStop[] {
  return [
    { stop: catalog.stops[0]!, distanceMeters: 42 },
    { stop: catalog.stops[1]!, distanceMeters: 125 },
  ];
}

describe('NearbyArrivals', () => {
  it('requests one ID-only batch and renders route, direction, full plate, and remaining stops', async () => {
    const arrivalsClient: ArrivalsClient = {
      getForStops: vi.fn().mockResolvedValue(response([{
        stopId: 'M1',
        route: '1',
        direction: 0,
        plate: 'AB1234',
        remainingStops: 2,
      }])),
    };

    render(
      <NearbyArrivals
        nearbyStops={nearbyStops()}
        repository={repository}
        arrivalsClient={arrivalsClient}
        onOpenRoute={vi.fn()}
      />,
    );

    await waitFor(() => expect(arrivalsClient.getForStops).toHaveBeenCalledTimes(1));
    expect(arrivalsClient.getForStops).toHaveBeenCalledWith(['M1', 'M2'], expect.any(AbortSignal));
    expect(screen.getByText('甲站')).toBeVisible();
    expect(screen.getByRole('button', { name: '開啟路線 1 甲 → 乙 AB1234' })).toBeVisible();
    expect(screen.getByText('甲 → 乙')).toBeVisible();
    expect(screen.getByText('AB1234')).toBeVisible();
    expect(screen.getByText('仲有 2 站')).toBeVisible();
    expect(screen.queryByText('22.1901')).not.toBeInTheDocument();
  });

  it('shows 已到站 and opens the matching route direction from an arrival row', async () => {
    const onOpenRoute = vi.fn();
    const arrivalsClient: ArrivalsClient = {
      getForStops: vi.fn().mockResolvedValue(response([{
        stopId: 'M1',
        route: '1',
        direction: 1,
        plate: 'AB5678',
        remainingStops: 0,
      }])),
    };

    render(
      <NearbyArrivals
        nearbyStops={[nearbyStops()[0]!]}
        repository={repository}
        arrivalsClient={arrivalsClient}
        onOpenRoute={onOpenRoute}
      />,
    );

    const arrival = await screen.findByRole('button', { name: /開啟路線 1.*乙 → 甲/ });
    expect(screen.getByText('已到站')).toBeVisible();
    fireEvent.click(arrival);
    expect(onOpenRoute).toHaveBeenCalledWith('1', 1);
  });

  it('keeps the nearby stop rows usable and shows scoped realtime failure copy', async () => {
    const arrivalsClient: ArrivalsClient = {
      getForStops: vi.fn().mockRejectedValue(new Error('upstream unavailable')),
    };

    render(
      <NearbyArrivals
        nearbyStops={nearbyStops()}
        repository={repository}
        arrivalsClient={arrivalsClient}
        onOpenRoute={vi.fn()}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('暫時無法取得附近實時到站資料');
    expect(screen.getByText('甲站')).toBeVisible();
    expect(screen.getByText('中央站')).toBeVisible();
    expect(screen.getAllByRole('button', { name: '開啟路線 1 測試線' })).toHaveLength(2);
  });

  it('aborts the previous batch when nearby stops change and on unmount', () => {
    const signals: AbortSignal[] = [];
    const arrivalsClient: ArrivalsClient = {
      getForStops: vi.fn((_stopIds, signal) => {
        signals.push(signal!);
        return new Promise<ArrivalsResponse>(() => undefined);
      }),
    };
    const { rerender, unmount } = render(
      <NearbyArrivals
        nearbyStops={[nearbyStops()[0]!]}
        repository={repository}
        arrivalsClient={arrivalsClient}
        onOpenRoute={vi.fn()}
      />,
    );

    expect(signals).toHaveLength(1);
    rerender(
      <NearbyArrivals
        nearbyStops={[nearbyStops()[1]!]}
        repository={repository}
        arrivalsClient={arrivalsClient}
        onOpenRoute={vi.fn()}
      />,
    );
    expect(signals[0]!.aborted).toBe(true);
    expect(signals).toHaveLength(2);
    unmount();
    expect(signals[1]!.aborted).toBe(true);
  });
});
