// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import fixture from '../../tests/fixtures/catalog/catalog.json';
import type { TransitCatalog } from '../../shared/transit-contract';
import { createLocalPreferences, type PreferencesStorage } from '../infra/local-preferences';
import { App } from './App';

class MemoryStorage implements PreferencesStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe('app Pages asset paths', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });

  it('loads the catalog below the configured Vite base path', async () => {
    vi.stubEnv('BASE_URL', '/macau-bus-pwa/');
    const fetcher = vi.fn(async () => new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetcher);

    render(<App />);

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/macau-bus-pwa/data/catalog.json'));
  });

  it('opens the bus shell for a legacy route URL even when parking is remembered', async () => {
    window.history.replaceState(null, '', '/?tab=routes&route=1&direction=1');
    const preferences = createLocalPreferences({ storage: new MemoryStorage() });
    preferences.setActiveMode('parking');

    render(<App loadCatalogData={async () => fixture as TransitCatalog} preferences={preferences} />);

    await waitFor(() => expect(screen.getByRole('button', { name: '路線' })).toBeVisible());
    expect(screen.queryByRole('button', { name: '搜尋' })).not.toBeInTheDocument();
  });

  it('syncs parent-owned parking search query to replaceState without leaking into nearby', async () => {
    window.history.replaceState(null, '', '/?mode=parking&tab=search');
    const preferences = createLocalPreferences({ storage: new MemoryStorage() });
    preferences.setActiveMode('parking');
    const parkingClient = {
      getSnapshot: vi.fn().mockResolvedValue({
        updatedAt: '2026-08-22T10:00:00+08:00',
        stale: false,
        facilities: [],
      }),
    };

    render(<App
      loadCatalogData={async () => fixture as TransitCatalog}
      preferences={preferences}
      parkingClient={parkingClient}
    />);

    const input = await screen.findByRole('searchbox', { name: '搜尋停車場名稱或位置' });
    fireEvent.change(input, { target: { value: '氹仔' } });
    expect(new URLSearchParams(window.location.search).get('q')).toBe('氹仔');
    fireEvent.click(screen.getByRole('button', { name: '附近' }));
    expect(new URLSearchParams(window.location.search).get('q')).toBeNull();
    expect(screen.queryByRole('searchbox', { name: '搜尋停車場名稱或位置' })).not.toBeInTheDocument();
  });

  it('keeps a parking map detail return source when opening and leaving a facility', async () => {
    window.history.replaceState(null, '', '/?mode=parking&tab=map');
    const preferences = createLocalPreferences({ storage: new MemoryStorage() });
    preferences.setActiveMode('parking');
    const parkingClient = {
      getSnapshot: vi.fn().mockResolvedValue({
        updatedAt: '2026-08-22T10:00:00+08:00',
        stale: false,
        facilities: [{
          id: '42',
          name: '甲停車場',
          location: '澳門半島',
          entrance: null,
          latitude: 22.198,
          longitude: 113.543,
          spaces: { car: 10, motorcycle: null, electricCar: null, electricMotorcycle: null, accessible: null },
          updatedAt: '2026-08-22T10:00:00+08:00',
          suspended: false,
        }],
      }),
    };

    render(<App
      loadCatalogData={async () => fixture as TransitCatalog}
      preferences={preferences}
      parkingClient={parkingClient}
    />);

    fireEvent.click(await screen.findByRole('button', { name: '選取甲停車場' }));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('from')).toBe('map'));
    expect(screen.getByRole('heading', { name: '甲停車場' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('tab')).toBe('map'));
  });

  it('remembers a parking search query while switching modes', async () => {
    window.history.replaceState(null, '', '/?mode=parking&tab=search&q=%E6%B0%B9%E4%BB%94');
    const preferences = createLocalPreferences({ storage: new MemoryStorage() });
    preferences.setActiveMode('parking');
    const parkingClient = {
      getSnapshot: vi.fn().mockResolvedValue({ updatedAt: '2026-08-22T10:00:00+08:00', stale: false, facilities: [] }),
    };

    render(<App
      loadCatalogData={async () => fixture as TransitCatalog}
      preferences={preferences}
      parkingClient={parkingClient}
    />);

    expect(await screen.findByRole('searchbox', { name: '搜尋停車場名稱或位置' })).toHaveValue('氹仔');
    fireEvent.click(screen.getByRole('button', { name: '切換至巴士模式' }));
    fireEvent.click(screen.getByRole('button', { name: '切換至泊車模式' }));
    expect(await screen.findByRole('searchbox', { name: '搜尋停車場名稱或位置' })).toHaveValue('氹仔');
    expect(new URLSearchParams(window.location.search).get('q')).toBe('氹仔');
  });
});
