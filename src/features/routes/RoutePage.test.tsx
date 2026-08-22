// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import fixture from '../../../tests/fixtures/catalog/catalog.json';
import { createCatalogRepository } from '../../data/catalog-repository';
import { createLocalPreferences, type LocalPreferences, type PreferencesStorage } from '../../infra/local-preferences';
import type { PushClient } from '../../infra/push-client';
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
  props: { devMode?: boolean; pushClient?: PushClient; initialDirectionId?: 0 | 1 } = {},
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

function pushClient(): PushClient {
  return {
    support: () => ({ supported: true, permission: 'granted' }),
    listAlerts: vi.fn().mockResolvedValue([]),
    createAlert: vi.fn().mockResolvedValue({ id: 'alert-1', routeId: '1', direction: 0, targetStopId: 'M1', targetStopIndex: 0, threshold: 3 }),
    deleteAlert: vi.fn().mockResolvedValue(undefined),
  };
}

describe('RoutePage', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens on stops with stops first and shows full observed plate badges', async () => {
    const getRealtimeRoute = vi.fn().mockResolvedValue(realtime({ buses: [{ ...realtime().buses[0]!, plate: 'AB1234', stationCode: 'M1' }] }));
    renderRoute(getRealtimeRoute);

    const dataTabs = within(screen.getByRole('tablist', { name: '路線資料' })).getAllByRole('tab');
    expect(dataTabs.map((tab) => tab.textContent)).toEqual(['站點', '實時巴士']);
    expect(dataTabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('AB1234')).toBeVisible();
    expect(screen.queryByText('有觀測')).not.toBeInTheDocument();
  });

  it('opens the reminder sheet from a stop and uses the saved default lead count', async () => {
    const client = pushClient();
    const getRealtimeRoute = vi.fn().mockResolvedValue(realtime());
    renderRoute(getRealtimeRoute, { pushClient: client });

    fireEvent.click(screen.getByRole('button', { name: /設定 甲站 到站提醒/ }));
    expect(await screen.findByRole('dialog', { name: '設定到站提醒' })).toBeVisible();
    expect(screen.getByText('提前 3 站')).toBeVisible();
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

  it('honours a direction supplied by the route URL', async () => {
    const getRealtimeRoute = vi.fn().mockResolvedValue(realtime());
    renderRoute(getRealtimeRoute, { initialDirectionId: 1 });

    expect(screen.getByRole('tab', { name: '乙 → 甲' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(getRealtimeRoute).toHaveBeenCalledWith('1', 1, expect.any(AbortSignal)));
  });

  it('renders loading, error and stale age states without crashing the route page', async () => {
    const pending = new Promise<RealtimeRouteResponse>(() => undefined);
    const loadingClient = vi.fn().mockReturnValue(pending);
    const loadingView = renderRoute(loadingClient);
    fireEvent.click(within(loadingView.container).getByRole('tab', { name: '實時巴士' }));
    expect(screen.getByText('正在取得即時巴士資料…')).toBeVisible();

    const errorClient = vi.fn().mockRejectedValue(new Error('offline'));
    const errorView = renderRoute(errorClient);
    fireEvent.click(within(errorView.container).getByRole('tab', { name: '實時巴士' }));
    expect(await screen.findByText('暫時無法取得即時巴士資料')).toBeVisible();

    const staleClient = vi.fn().mockResolvedValue(realtime({ stale: true, ageSeconds: 42 }));
    const staleView = renderRoute(staleClient);
    fireEvent.click(within(staleView.container).getByRole('tab', { name: '實時巴士' }));
    expect(await screen.findByText('目前顯示 42 秒前的資料')).toBeVisible();
  });

  it('labels station-coordinate bus positions explicitly and hides debug diagnostics outside development', async () => {
    const getRealtimeRoute = vi.fn().mockResolvedValue(realtime());
    const view = renderRoute(getRealtimeRoute, { devMode: false });
    fireEvent.click(within(view.container).getByRole('tab', { name: '實時巴士' }));

    expect(await screen.findByText('位置按站點顯示')).toBeVisible();
    expect(screen.queryByText('開發診斷')).not.toBeInTheDocument();
    expect(screen.getByText(/約 1 分鐘到 中央站/)).toBeVisible();
  });

  it('shows the full plate while masking development diagnostics', async () => {
    expect(isDebugPanelEnabled(true, false)).toBe(false);
    expect(isDebugPanelEnabled(true, true)).toBe(true);

    const getRealtimeRoute = vi.fn().mockResolvedValue(realtime({
      buses: [{ ...realtime().buses[0]!, plate: 'AB1234', stationCode: 'M1' }],
    }));
    const view = renderRoute(getRealtimeRoute, { devMode: true });
    fireEvent.click(within(view.container).getByRole('tab', { name: '實時巴士' }));

    expect(await screen.findByText('開發診斷')).toBeVisible();
    expect(screen.getByText('AB1234')).toBeVisible();
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
    const view = renderRoute(getRealtimeRoute, { devMode: true });
    fireEvent.click(within(view.container).getByRole('tab', { name: '實時巴士' }));

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
    const view = renderRoute(getRealtimeRoute, { devMode: false });
    fireEvent.click(within(view.container).getByRole('tab', { name: '實時巴士' }));

    await screen.findByText('位置按站點顯示');
    expect(debugFetch).not.toHaveBeenCalled();
  });

  it('exposes direction and data tab panels through aria controls', async () => {
    const getRealtimeRoute = vi.fn().mockResolvedValue(realtime());
    const view = renderRoute(getRealtimeRoute);

    const directionTab = screen.getByRole('tab', { name: '甲 → 乙' });
    expect(directionTab).toHaveAttribute('aria-controls', 'direction-panel');
    expect(screen.getByRole('tabpanel', { name: '甲 → 乙' })).toHaveAttribute('id', 'direction-panel');
    const realtimeTab = screen.getByRole('tab', { name: '實時巴士' });
    expect(realtimeTab).toHaveAttribute('aria-controls', 'realtime-panel');
    fireEvent.click(within(view.container).getByRole('tab', { name: '實時巴士' }));
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
