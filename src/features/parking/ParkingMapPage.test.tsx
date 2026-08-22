// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ParkingFacility } from '../../../shared/parking-contract';
import { createParkingTooltipContent, ParkingMapPage } from './ParkingMapPage';

const leafletMock = vi.hoisted(() => {
  const makeLayer = () => {
    const layer: {
      addTo: ReturnType<typeof vi.fn>;
      bindTooltip: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    } = {
      addTo: vi.fn(() => layer),
      bindTooltip: vi.fn(() => layer),
      on: vi.fn(() => layer),
    };
    return layer;
  };
  const map = {
    fitBounds: vi.fn(),
    invalidateSize: vi.fn(),
    remove: vi.fn(),
  };
  const layerGroup = {
    addTo: vi.fn(() => layerGroup),
    clearLayers: vi.fn(),
  };
  const module = {
    map: vi.fn(() => map),
    tileLayer: vi.fn(() => makeLayer()),
    layerGroup: vi.fn(() => layerGroup),
    marker: vi.fn(() => makeLayer()),
    divIcon: vi.fn((options: unknown) => options),
  };
  return { map, module };
});

vi.mock('leaflet', () => ({ default: leafletMock.module, ...leafletMock.module }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));

const facilities: ParkingFacility[] = [{
  id: '42', name: '甲停車場', location: '澳門半島', entrance: null, latitude: 22.198, longitude: 113.543,
  spaces: { car: 10, motorcycle: null, electricCar: null, electricMotorcycle: null, accessible: null }, updatedAt: '2026-08-22T10:00:00+08:00', suspended: false,
}];

describe('ParkingMapPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps a selectable list fallback while exposing the OSM map region', () => {
    const onSelectFacility = vi.fn();
    render(<ParkingMapPage facilities={facilities} selectedId={null} onSelectFacility={onSelectFacility} />);

    expect(screen.getByRole('region', { name: 'OpenStreetMap 泊車地圖' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /選取甲停車場/ }));
    expect(onSelectFacility).toHaveBeenCalledWith('42');
  });

  it('keeps an untrusted facility name as text instead of injectable tooltip markup', () => {
    const content = createParkingTooltipContent('<img src=x onerror="alert(1)">');

    expect(content).toBeInstanceOf(HTMLElement);
    expect(content.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(content.querySelector('img')).toBeNull();
  });

  it('shows retained-data freshness/error state with a refresh action', () => {
    const onRefresh = vi.fn();
    render(<ParkingMapPage
      facilities={facilities}
      selectedId={null}
      onSelectFacility={vi.fn()}
      updatedAt="2026-08-22T10:00:00+08:00"
      stale
      error={new Error('offline')}
      onRefresh={onRefresh}
    />);

    expect(screen.getByText('目前顯示較早的泊車位資料。')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('暫時無法取得泊車位資料。');
    expect(screen.getByText(/更新：/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not refit the viewport when only vacancy or name data changes', async () => {
    const { rerender } = render(<ParkingMapPage facilities={facilities} selectedId={null} onSelectFacility={vi.fn()} />);
    await waitFor(() => expect(leafletMock.module.map).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(leafletMock.map.fitBounds.mock.calls.length).toBeGreaterThan(0));
    const initialFitCount = leafletMock.map.fitBounds.mock.calls.length;
    const initialFacility = facilities[0];
    if (!initialFacility) {
      throw new Error('test facility missing');
    }

    const updatedFacilities: ParkingFacility[] = [{
      ...initialFacility,
      name: '甲停車場（更新）',
      spaces: { ...initialFacility.spaces, car: 3 },
    }];
    rerender(<ParkingMapPage facilities={updatedFacilities} selectedId={null} onSelectFacility={vi.fn()} />);
    expect(leafletMock.map.fitBounds).toHaveBeenCalledTimes(initialFitCount);

    const movedFacility = updatedFacilities[0];
    if (!movedFacility) {
      throw new Error('updated test facility missing');
    }
    rerender(<ParkingMapPage facilities={[{ ...movedFacility, latitude: 22.199 }]} selectedId={null} onSelectFacility={vi.fn()} />);
    expect(leafletMock.map.fitBounds).toHaveBeenCalledTimes(initialFitCount + 1);
  });
});
