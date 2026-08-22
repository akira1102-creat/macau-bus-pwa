// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ParkingFacility } from '../../../shared/parking-contract';
import { ParkingMapPage } from './ParkingMapPage';

const facilities: ParkingFacility[] = [{
  id: '42', name: '甲停車場', location: '澳門半島', entrance: null, latitude: 22.198, longitude: 113.543,
  spaces: { car: 10, motorcycle: null, electricCar: null, electricMotorcycle: null, accessible: null }, updatedAt: '2026-08-22T10:00:00+08:00', suspended: false,
}];

describe('ParkingMapPage', () => {
  it('keeps a selectable list fallback while exposing the OSM map region', () => {
    const onSelectFacility = vi.fn();
    render(<ParkingMapPage facilities={facilities} selectedId={null} onSelectFacility={onSelectFacility} />);

    expect(screen.getByRole('region', { name: 'OpenStreetMap 泊車地圖' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /選取甲停車場/ }));
    expect(onSelectFacility).toHaveBeenCalledWith('42');
  });
});
