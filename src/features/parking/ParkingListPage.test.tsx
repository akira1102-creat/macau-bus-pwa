// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ParkingFacility } from '../../../shared/parking-contract';
import { createLocalPreferences, type PreferencesStorage } from '../../infra/local-preferences';
import { ParkingListPage } from './ParkingListPage';

class MemoryStorage implements PreferencesStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

function facility(id: string, overrides: Partial<ParkingFacility> = {}): ParkingFacility {
  return {
    id,
    name: id === '42' ? '甲停車場' : '乙停車場',
    location: id === '42' ? '澳門半島' : '氹仔',
    entrance: null,
    latitude: id === '42' ? 22.198 : 22.2,
    longitude: id === '42' ? 113.543 : 113.55,
    spaces: { car: id === '42' ? 0 : 12, motorcycle: null, electricCar: null, electricMotorcycle: null, accessible: null },
    updatedAt: '2026-08-22T10:00:00+08:00',
    suspended: false,
    ...overrides,
  };
}

describe('ParkingListPage', () => {
  it('shows a complete list without GPS, filters search, and renders unknown values as —', async () => {
    const getCurrentPosition = vi.fn().mockRejectedValue({ code: 'permission-denied' });
    render(<ParkingListPage
      facilities={[facility('42'), facility('7')]}
      updatedAt="2026-08-22T10:00:00+08:00"
      stale
      preferences={createLocalPreferences({ storage: new MemoryStorage() })}
      onOpenDetail={vi.fn()}
      getCurrentPosition={getCurrentPosition}
    />);

    expect(screen.getByText('甲停車場')).toBeVisible();
    expect(screen.getByText('乙停車場')).toBeVisible();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText(/較早/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '使用目前位置' }));
    await waitFor(() => expect(screen.getByText(/仍可查看完整/)).toBeVisible());
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole('searchbox', { name: '搜尋停車場名稱或位置' }), { target: { value: '氹仔' } });
    expect(screen.queryByText('甲停車場')).not.toBeInTheDocument();
    expect(screen.getByText('乙停車場')).toBeVisible();
  });

  it('toggles stable-id favorites and opens a detail callback', () => {
    const onOpenDetail = vi.fn();
    const preferences = createLocalPreferences({ storage: new MemoryStorage() });
    render(<ParkingListPage
      facilities={[facility('42')]}
      updatedAt="2026-08-22T10:00:00+08:00"
      preferences={preferences}
      onOpenDetail={onOpenDetail}
    />);

    fireEvent.click(screen.getByRole('button', { name: '收藏停車場 甲停車場' }));
    expect(preferences.getParkingFavorites()).toEqual(['42']);
    fireEvent.click(screen.getByRole('button', { name: '開啟停車場 甲停車場' }));
    expect(onOpenDetail).toHaveBeenCalledWith('42');
  });
});
