// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import fixture from '../../../tests/fixtures/catalog/catalog.json';
import { createCatalogRepository } from '../../data/catalog-repository';
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
});
