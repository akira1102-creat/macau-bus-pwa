// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import fixture from '../../../tests/fixtures/catalog/catalog.json';
import { createCatalogRepository } from '../../data/catalog-repository';
import type { ArrivalsClient } from '../../infra/arrivals-client';
import { createLocalPreferences, type LocalPreferences, type PreferencesStorage } from '../../infra/local-preferences';
import { HomePage } from './HomePage';
import type { TransitCatalog } from '../../../shared/transit-contract';

const catalog = fixture as TransitCatalog;

class MemoryStorage implements PreferencesStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function preferences(): LocalPreferences {
  return createLocalPreferences({ storage: new MemoryStorage() });
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('filters the real catalog by route name and opens the selected route', () => {
    const onOpenRoute = vi.fn();
    render(
      <HomePage
        catalog={catalog}
        repository={createCatalogRepository(catalog)}
        preferences={preferences()}
        onOpenRoute={onOpenRoute}
        getCurrentPosition={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: '搜尋路線或巴士站' }), {
      target: { value: '測試線' },
    });

    const result = screen.getByRole('button', { name: /1.*測試線/ });
    expect(result).toBeVisible();
    fireEvent.click(result);
    expect(onOpenRoute).toHaveBeenCalledWith('1');
  });

  it('requests local location only after the nearby action and renders sorted stops', async () => {
    const getCurrentPosition = vi.fn().mockResolvedValue({ latitude: 22.1901, longitude: 113.5401 });
    render(
      <HomePage
        catalog={catalog}
        repository={createCatalogRepository(catalog)}
        preferences={preferences()}
        onOpenRoute={vi.fn()}
        getCurrentPosition={getCurrentPosition}
      />,
    );

    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '使用目前位置' }));
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('附近巴士站')).toBeVisible();
    expect(screen.getByText('甲站')).toBeVisible();
  });

  it('uses the latest radius when location resolves after a radius change', async () => {
    type PendingPosition = { latitude: number; longitude: number; accuracyMeters: null };
    let resolvePosition: ((position: PendingPosition) => void) | undefined;
    const getCurrentPosition = vi.fn(() => new Promise<PendingPosition>((resolve) => {
      resolvePosition = resolve;
    }));
    render(
      <HomePage
        catalog={catalog}
        repository={createCatalogRepository(catalog)}
        preferences={preferences()}
        onOpenRoute={vi.fn()}
        getCurrentPosition={getCurrentPosition}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '使用目前位置' }));
    fireEvent.click(screen.getByRole('button', { name: /300 米/ }));
    resolvePosition?.({ latitude: 22.1901, longitude: 113.5401, accuracyMeters: null });

    await waitFor(() => expect(screen.getByText('中央站')).toBeVisible());
    expect(screen.queryByText('乙站')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /300 米/ })).toHaveClass('is-selected');
  });

  it.each([
    ['permission-denied', '已拒絕位置權限'],
    ['unsupported', '此瀏覽器不支援定位'],
  ] as const)('keeps the radius selector visible after %s', async (code, message) => {
    const getCurrentPosition = vi.fn().mockRejectedValue({ code });
    render(
      <HomePage
        catalog={catalog}
        repository={createCatalogRepository(catalog)}
        preferences={preferences()}
        onOpenRoute={vi.fn()}
        getCurrentPosition={getCurrentPosition}
      />,
    );

    const oneKilometre = screen.getByRole('button', { name: /1 公里/ });
    fireEvent.click(oneKilometre);
    fireEvent.click(screen.getByRole('button', { name: '使用目前位置' }));

    expect(await screen.findByText(new RegExp(message))).toBeVisible();
    expect(oneKilometre).toHaveClass('is-selected');
    expect(screen.getByRole('button', { name: /300 米/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /500 米/ })).toBeVisible();
    const retry = screen.getByRole('button', { name: '使用目前位置' });
    expect(retry).not.toBeDisabled();
    fireEvent.click(retry);
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(2));
  });

  it('lets search results choose every route associated with one station', () => {
    const firstRoute = catalog.routes[0]!;
    const multiRouteCatalog: TransitCatalog = {
      ...catalog,
      routes: [
        firstRoute,
        { ...firstRoute, id: '2', name: '2', displayName: '另一條線' },
      ],
      stops: catalog.stops.map((stop) => stop.id === 'M1' ? { ...stop, routeIds: ['1', '2'] } : stop),
    };
    const onOpenRoute = vi.fn();
    render(
      <HomePage
        catalog={multiRouteCatalog}
        repository={createCatalogRepository(multiRouteCatalog)}
        preferences={preferences()}
        onOpenRoute={onOpenRoute}
        getCurrentPosition={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: '搜尋路線或巴士站' }), { target: { value: '甲站' } });

    const routeOne = screen.getByRole('button', { name: '開啟路線 1 測試線' });
    const routeTwo = screen.getByRole('button', { name: '開啟路線 2 另一條線' });
    expect(routeOne).toBeVisible();
    expect(routeTwo).toBeVisible();
    fireEvent.click(routeTwo);
    expect(onOpenRoute).toHaveBeenCalledWith('2');
  });

  it('lets nearby results choose every associated route', async () => {
    const firstRoute = catalog.routes[0]!;
    const multiRouteCatalog: TransitCatalog = {
      ...catalog,
      routes: [firstRoute, { ...firstRoute, id: '2', name: '2', displayName: '另一條線' }],
      stops: catalog.stops.map((stop) => stop.id === 'M1' ? { ...stop, routeIds: ['1', '2'] } : stop),
    };
    const onOpenRoute = vi.fn();
    render(
      <HomePage
        catalog={multiRouteCatalog}
        repository={createCatalogRepository(multiRouteCatalog)}
        preferences={preferences()}
        onOpenRoute={onOpenRoute}
        getCurrentPosition={vi.fn().mockResolvedValue({ latitude: 22.1901, longitude: 113.5401 })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '使用目前位置' }));
    expect(await screen.findByText('附近巴士站')).toBeVisible();
    const routeTwo = await screen.findByRole('button', { name: '開啟路線 2 另一條線' });
    fireEvent.click(routeTwo);
    expect(onOpenRoute).toHaveBeenCalledWith('2');
  });

  it('persists favorite and recent route actions through local preferences', () => {
    const preferenceStore = preferences();
    render(
      <HomePage
        catalog={catalog}
        repository={createCatalogRepository(catalog)}
        preferences={preferenceStore}
        onOpenRoute={vi.fn()}
        getCurrentPosition={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: '搜尋路線或巴士站' }), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /收藏路線 1/ }));
    expect(preferenceStore.getFavorites()).toEqual(['1']);

    fireEvent.change(screen.getByRole('searchbox', { name: '搜尋路線或巴士站' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '開啟路線 1 測試線' }));
    expect(preferenceStore.getRecent()).toEqual(['1']);
  });

  it('requests nearby arrivals only after location succeeds and sends stop IDs without GPS coordinates', async () => {
    const getCurrentPosition = vi.fn().mockResolvedValue({ latitude: 22.1901, longitude: 113.5401 });
    const arrivalsClient: ArrivalsClient = {
      getForStops: vi.fn().mockResolvedValue({ updatedAt: '2026-08-22T00:00:00.000Z', arrivals: [] }),
    };
    render(
      <HomePage
        catalog={catalog}
        repository={createCatalogRepository(catalog)}
        preferences={preferences()}
        onOpenRoute={vi.fn()}
        getCurrentPosition={getCurrentPosition}
        arrivalsClient={arrivalsClient}
      />,
    );

    expect(arrivalsClient.getForStops).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '使用目前位置' }));
    await waitFor(() => expect(arrivalsClient.getForStops).toHaveBeenCalledTimes(1));
    const [stopIds] = (arrivalsClient.getForStops as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(stopIds).toEqual(['M1', 'M2', 'M3']);
    expect(JSON.stringify(stopIds)).not.toContain('22.1901');
    expect(JSON.stringify(stopIds)).not.toContain('113.5401');
  });

  it('renders nearby arrival details and opens the returned route direction', async () => {
    const onOpenRoute = vi.fn();
    const arrivalsClient: ArrivalsClient = {
      getForStops: vi.fn().mockResolvedValue({
        updatedAt: '2026-08-22T00:00:00.000Z',
        arrivals: [{ stopId: 'M1', route: '1', direction: 1, plate: 'AB1234', remainingStops: 0 }],
      }),
    };
    render(
      <HomePage
        catalog={catalog}
        repository={createCatalogRepository(catalog)}
        preferences={preferences()}
        onOpenRoute={onOpenRoute}
        getCurrentPosition={vi.fn().mockResolvedValue({ latitude: 22.1901, longitude: 113.5401 })}
        arrivalsClient={arrivalsClient}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '使用目前位置' }));
    const arrival = await screen.findByRole('button', { name: /開啟路線 1.*乙 → 甲/ });
    expect(screen.getByText('AB1234')).toBeVisible();
    expect(screen.getByText('已到站')).toBeVisible();
    fireEvent.click(arrival);
    expect(onOpenRoute).toHaveBeenCalledWith('1', 1);
  });

  it('keeps nearby stops visible when the arrivals API fails', async () => {
    const arrivalsClient: ArrivalsClient = {
      getForStops: vi.fn().mockRejectedValue(new Error('realtime unavailable')),
    };
    render(
      <HomePage
        catalog={catalog}
        repository={createCatalogRepository(catalog)}
        preferences={preferences()}
        onOpenRoute={vi.fn()}
        getCurrentPosition={vi.fn().mockResolvedValue({ latitude: 22.1901, longitude: 113.5401 })}
        arrivalsClient={arrivalsClient}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '使用目前位置' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('暫時無法取得附近實時到站資料');
    expect(screen.getByText('甲站')).toBeVisible();
    expect(screen.getByText('中央站')).toBeVisible();
  });
});
