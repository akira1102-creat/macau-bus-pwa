// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import fixture from '../../../tests/fixtures/catalog/catalog.json';
import { createCatalogRepository } from '../../data/catalog-repository';
import { createLocalPreferences, type LocalPreferences, type PreferencesStorage } from '../../infra/local-preferences';
import { isDebugPanelEnabled, RoutePage } from './RoutePage';
import type { RealtimeRouteResponse, TransitCatalog } from '../../../shared/transit-contract';

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

function realtime(overrides: Partial<RealtimeRouteResponse> = {}): RealtimeRouteResponse {
  return {
    route: '1',
    direction: 0,
    updatedAt: '2026-08-21T00:00:00.000Z',
    ageSeconds: 0,
    stale: false,
    source: 'DSAT observation',
    buses: [
      {
        plate: 'AA••34',
        stationCode: 'M1',
        speedKph: 23,
        status: '行駛中',
        passengerFlow: null,
        busType: '澳巴',
        facilities: null,
      },
    ],
    ...overrides,
  };
}

function renderRoute(
  getRealtimeRoute: ReturnType<typeof vi.fn>,
  props: { devMode?: boolean } = {},
) {
  return render(
    <RoutePage
      routeId="1"
      catalog={catalog}
      repository={createCatalogRepository(catalog)}
      preferences={preferences()}
      realtimeClient={{ getRealtimeRoute }}
      onBack={vi.fn()}
      showMap={false}
      {...props}
    />,
  );
}

describe('RoutePage', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the route number above the route identity without shrinking the touch targets', async () => {
    const getRealtimeRoute = vi.fn().mockResolvedValue(realtime());
    renderRoute(getRealtimeRoute);

    const header = screen.getByRole('heading', { name: '測試線' }).closest('header');
    expect(header).not.toBeNull();
    expect(within(header!).getByText('路線 1')).toBeVisible();
    expect(screen.getByRole('button', { name: '返回' })).toHaveClass('icon-button');
    expect(screen.getByRole('button', { name: '收藏路線 1' })).toHaveClass('icon-button');
  });

  it('styles the route number as a compact jade badge', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles/app.css'), 'utf8');
    expect(styles).toMatch(/\.route-title \.route-number\s*\{[^}]*min-height:\s*28px[^}]*background:\s*var\(--color-jade-soft\)/s);
  });

  it('switches direction tabs and keeps the catalog station order', async () => {
    const getRealtimeRoute = vi.fn().mockResolvedValue(realtime());
    renderRoute(getRealtimeRoute);

    expect(screen.getByRole('tab', { name: '甲 → 乙' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: '乙 → 甲' }));
    expect(screen.getByRole('tab', { name: '乙 → 甲' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: '站點' }));
    expect(screen.getByText('乙站')).toBeVisible();
    expect(screen.getByText('甲站')).toBeVisible();
    await waitFor(() => expect(getRealtimeRoute).toHaveBeenCalledWith('1', 1, expect.any(AbortSignal)));
  });

  it('renders loading, error and stale age states without crashing the route page', async () => {
    const pending = new Promise<RealtimeRouteResponse>(() => undefined);
    const loadingClient = vi.fn().mockReturnValue(pending);
    renderRoute(loadingClient);
    expect(screen.getByText('正在取得即時巴士資料…')).toBeVisible();

    const errorClient = vi.fn().mockRejectedValue(new Error('offline'));
    renderRoute(errorClient);
    expect(await screen.findByText('暫時無法取得即時巴士資料')).toBeVisible();

    const staleClient = vi.fn().mockResolvedValue(realtime({ stale: true, ageSeconds: 42 }));
    renderRoute(staleClient);
    expect(await screen.findByText('目前顯示 42 秒前的資料')).toBeVisible();
  });

  it('labels station-coordinate bus positions explicitly and hides debug diagnostics outside development', async () => {
    const getRealtimeRoute = vi.fn().mockResolvedValue(realtime());
    renderRoute(getRealtimeRoute, { devMode: false });

    expect(await screen.findByText('位置按站點顯示')).toBeVisible();
    expect(screen.queryByText('開發診斷')).not.toBeInTheDocument();
    expect(screen.getByText(/約 1 分鐘到 中央站/)).toBeVisible();
  });

  it('masks plate and station code diagnostics and requires a development build', async () => {
    expect(isDebugPanelEnabled(true, false)).toBe(false);
    expect(isDebugPanelEnabled(true, true)).toBe(true);

    const getRealtimeRoute = vi.fn().mockResolvedValue(realtime({
      buses: [{ ...realtime().buses[0]!, plate: 'AB1234', stationCode: 'M1' }],
    }));
    renderRoute(getRealtimeRoute, { devMode: true });

    expect(await screen.findByText('開發診斷')).toBeVisible();
    expect(screen.queryByText('AB1234')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('開發診斷'));
    const panel = screen.getByText('開發診斷').closest('details');
    expect(panel).not.toBeNull();
    expect(within(panel!).queryByText('AB1234')).not.toBeInTheDocument();
    expect(within(panel!).queryByText('M1')).not.toBeInTheDocument();
    expect(within(panel!).getByText('A••4')).toBeVisible();
    expect(within(panel!).getByText('••')).toBeVisible();
  });

  it('fetches and renders the masked development debug response only when enabled', async () => {
    const debugFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        route: '1',
        direction: 0,
        buses: [{ ...realtime().buses[0], plate: '[MASKED]' }],
        raw: { debugOnly: 'masked-response' },
      }),
    });
    vi.stubGlobal('fetch', debugFetch);
    const getRealtimeRoute = vi.fn().mockResolvedValue(realtime());
    renderRoute(getRealtimeRoute, { devMode: true });

    const summary = await screen.findByText('開發診斷');
    await waitFor(() => expect(debugFetch).toHaveBeenCalledWith('/api/debug/dsat/1/0', expect.objectContaining({ method: 'GET' })));
    fireEvent.click(summary);
    expect(await screen.findByText(/masked-response/)).toBeVisible();
    expect(screen.queryByText('AB1234')).not.toBeInTheDocument();
  });

  it('does not fetch the development debug endpoint when dev mode is disabled', async () => {
    const debugFetch = vi.fn();
    vi.stubGlobal('fetch', debugFetch);
    const getRealtimeRoute = vi.fn().mockResolvedValue(realtime());
    renderRoute(getRealtimeRoute, { devMode: false });

    await screen.findByText('位置按站點顯示');
    expect(debugFetch).not.toHaveBeenCalled();
  });

  it('exposes direction and data tab panels through aria controls', async () => {
    const getRealtimeRoute = vi.fn().mockResolvedValue(realtime());
    renderRoute(getRealtimeRoute);

    const directionTab = screen.getByRole('tab', { name: '甲 → 乙' });
    expect(directionTab).toHaveAttribute('aria-controls', 'direction-panel');
    expect(screen.getByRole('tabpanel', { name: '甲 → 乙' })).toHaveAttribute('id', 'direction-panel');
    const realtimeTab = screen.getByRole('tab', { name: '實時巴士' });
    expect(realtimeTab).toHaveAttribute('aria-controls', 'realtime-panel');
    expect(await screen.findByRole('tabpanel', { name: '實時巴士' })).toHaveAttribute('aria-live', 'polite');
  });

  it('polls only while the document is visible and uses the selected direction', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const getRealtimeRoute = vi.fn().mockResolvedValue(realtime());
    renderRoute(getRealtimeRoute);
    await Promise.resolve();
    expect(getRealtimeRoute).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(12_000);
    expect(getRealtimeRoute).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(getRealtimeRoute).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(getRealtimeRoute).toHaveBeenCalledTimes(3);
  });
});
