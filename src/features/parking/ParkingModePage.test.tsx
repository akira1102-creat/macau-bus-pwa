// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ParkingApiClient } from '../../infra/parking-client';
import type { ParkingSnapshot } from '../../../shared/parking-contract';
import { createLocalPreferences } from '../../infra/local-preferences';
import { ParkingModePage } from './ParkingModePage';

const snapshot: ParkingSnapshot = {
  updatedAt: '2026-08-22T10:00:00+08:00',
  stale: false,
  facilities: [{
    id: '42',
    name: '甲停車場',
    location: '澳門半島',
    entrance: null,
    latitude: 22.198,
    longitude: 113.543,
    spaces: { car: 10, motorcycle: 2, electricCar: null, electricMotorcycle: null, accessible: null },
    updatedAt: '2026-08-22T10:00:00+08:00',
    suspended: false,
  }],
};

describe('ParkingModePage', () => {
  it('shows retry instead of not-found when the initial detail fetch fails', async () => {
    const getSnapshot = vi.fn().mockRejectedValue(new Error('offline'));
    const client = { getSnapshot } satisfies ParkingApiClient;

    render(<ParkingModePage
      tab="detail"
      parkingId="42"
      client={client}
      preferences={createLocalPreferences()}
      onOpenDetail={vi.fn()}
      onBack={vi.fn()}
    />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('暫時無法取得泊車位資料。'));
    expect(screen.queryByText('找不到符合的停車場。')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新整理' })).toBeVisible();
  });

  it('keeps search query state parent-owned and reports map detail source', async () => {
    const getSnapshot = vi.fn().mockResolvedValue(snapshot);
    const onQueryChange = vi.fn();
    const client = { getSnapshot } satisfies ParkingApiClient;
    const { rerender } = render(<ParkingModePage
      tab="search"
      query="甲"
      onQueryChange={onQueryChange}
      client={client}
      preferences={createLocalPreferences()}
      onOpenDetail={vi.fn()}
      onBack={vi.fn()}
    />);

    const input = await screen.findByRole('searchbox', { name: '搜尋停車場名稱或位置' });
    expect(input).toHaveValue('甲');
    fireEvent.change(input, { target: { value: '澳門' } });
    expect(onQueryChange).toHaveBeenCalledWith('澳門');

    const onOpenDetail = vi.fn();
    rerender(<ParkingModePage
      tab="map"
      client={client}
      preferences={createLocalPreferences()}
      onOpenDetail={onOpenDetail}
      onBack={vi.fn()}
    />);
    fireEvent.click(await screen.findByRole('button', { name: '選取甲停車場' }));
    expect(onOpenDetail).toHaveBeenCalledWith('42', 'map');
  });
});
