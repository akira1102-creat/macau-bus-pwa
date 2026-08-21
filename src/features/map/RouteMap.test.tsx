// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { BusStop, RealtimeBus } from '../../../shared/transit-contract';
import RouteMap from './RouteMap';

const leafletMock = vi.hoisted(() => {
  const makeLayer = () => {
    const layer: {
      addTo: ReturnType<typeof vi.fn>;
      bindTooltip: ReturnType<typeof vi.fn>;
    } = {
      addTo: vi.fn((target: { addLayer?: (value: unknown) => void }) => {
        target.addLayer?.(layer);
        return layer;
      }),
      bindTooltip: vi.fn(() => layer),
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
    addLayer: vi.fn(),
    clearLayers: vi.fn(),
  };
  const module = {
    map: vi.fn(() => map),
    tileLayer: vi.fn(() => makeLayer()),
    layerGroup: vi.fn(() => layerGroup),
    polyline: vi.fn(() => makeLayer()),
    circleMarker: vi.fn(() => makeLayer()),
    marker: vi.fn(() => makeLayer()),
    divIcon: vi.fn((options: unknown) => options),
  };
  return { map, layerGroup, module };
});

vi.mock('leaflet', () => ({ default: leafletMock.module, ...leafletMock.module }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));

const stops: BusStop[] = [
  { id: 'M1', name: 'M1', nameCn: '甲站', coordinates: [113.5401, 22.1901], routeIds: ['1'] },
  { id: 'M2', name: 'M2', nameCn: '中央站', coordinates: [113.5411, 22.1911], routeIds: ['1'] },
];

const buses: RealtimeBus[] = [{
  plate: 'AA••34',
  stationCode: 'M2',
  speedKph: 12,
  status: '行駛中',
  passengerFlow: null,
  busType: null,
  facilities: null,
}];

afterEach(() => {
  vi.clearAllMocks();
});

describe('RouteMap', () => {
  it('renders the map container, OSM attribution, route path, station dots, bus marker and user marker', async () => {
    const { container } = render(
      <RouteMap
        stops={stops}
        buses={buses}
        userPosition={{ latitude: 22.1905, longitude: 113.5405, accuracyMeters: 10 }}
        onRequestLocation={vi.fn()}
      />,
    );

    await waitFor(() => expect(leafletMock.module.map).toHaveBeenCalledTimes(1));
    expect(container.querySelector('.route-map')).toHaveAttribute('aria-label', 'OpenStreetMap 路線地圖');
    expect(leafletMock.module.tileLayer).toHaveBeenCalledWith(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      expect.objectContaining({ attribution: expect.stringContaining('OpenStreetMap') }),
    );
    expect(leafletMock.module.polyline).toHaveBeenCalledWith(
      [[22.1901, 113.5401], [22.1911, 113.5411]],
      expect.objectContaining({ color: '#008765' }),
    );
    expect(leafletMock.module.circleMarker).toHaveBeenCalledTimes(3);
    expect(leafletMock.module.marker).toHaveBeenCalledTimes(1);
    expect(leafletMock.module.divIcon).toHaveBeenCalledWith(expect.objectContaining({
      html: expect.stringContaining('map-bus-marker'),
    }));
    expect(screen.getByRole('button', { name: '使用目前位置' })).toBeVisible();
  });

  it('keeps Leaflet zoom controls browser-ready at the 44px target size', async () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles/app.css'), 'utf8');
    expect(styles).toMatch(/\.leaflet-control-zoom a[^{]*\{[^}]*width:\s*44px[^}]*height:\s*44px/s);
  });
});
