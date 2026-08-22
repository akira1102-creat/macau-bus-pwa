// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ParkingFacility } from '../../../shared/parking-contract';
import { ParkingDetailPage } from './ParkingDetailPage';

const facility: ParkingFacility = {
  id: '42',
  name: '甲停車場',
  location: '澳門半島',
  entrance: '東入口',
  latitude: null,
  longitude: null,
  spaces: { car: null, motorcycle: 3, electricCar: 1, electricMotorcycle: null, accessible: 2 },
  updatedAt: null,
  suspended: true,
};

describe('ParkingDetailPage', () => {
  it('shows all supplied counts, null/paused values as —, and exposes alert/navigation callbacks', () => {
    const onRequestAlert = vi.fn();
    const openNavigation = vi.fn();
    render(<ParkingDetailPage facility={facility} favorite={false} onToggleFavorite={vi.fn()} onRequestAlert={onRequestAlert} openNavigation={openNavigation} onBack={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '甲停車場' })).toBeVisible();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByRole('button', { name: '導航' }));
    fireEvent.click(screen.getByRole('button', { name: '設定低空位提醒' }));
    expect(openNavigation).toHaveBeenCalledWith(facility);
    expect(onRequestAlert).toHaveBeenCalledWith(facility);
    expect(screen.getByText(/資料來自 DSAT/)).toBeVisible();
  });
});
