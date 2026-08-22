import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { ParkingFacility } from '../../../shared/parking-contract';
import { messages } from '../../i18n/messages';
import { displayParkingSpace, parkingHasCoordinates } from './parking-utils';

export interface ParkingMapPageProps {
  facilities: readonly ParkingFacility[];
  selectedId: string | null;
  onSelectFacility: (parkingId: string) => void;
}

interface MapRefs {
  map: Leaflet.Map | null;
  layer: Leaflet.LayerGroup | null;
  leaflet: typeof Leaflet | null;
}

export function ParkingMapPage({ facilities, selectedId, onSelectFacility }: ParkingMapPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const refs = useRef<MapRefs>({ map: null, layer: null, leaflet: null });
  const facilitiesRef = useRef(facilities);
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'unavailable' | 'offline' | 'tile-error'>(
    () => (typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'loading'),
  );
  facilitiesRef.current = facilities;

  const drawMarkers = () => {
    const { map, layer, leaflet: L } = refs.current;
    if (!map || !layer || !L) {
      return;
    }
    layer.clearLayers();
    const mappable = facilitiesRef.current.filter(parkingHasCoordinates);
    mappable.forEach((facility) => {
      const marker = L.marker([facility.latitude, facility.longitude], {
        icon: L.divIcon({
          className: 'parking-map-marker-wrap',
          html: `<span class="parking-map-marker${facility.id === selectedId ? ' is-selected' : ''}">${displayParkingSpace(facility.spaces.car, facility.suspended)}</span>`,
          iconSize: [48, 32],
          iconAnchor: [24, 16],
        }),
      });
      marker.bindTooltip(facility.name, { direction: 'top', offset: [0, -12] });
      marker.on('click', () => onSelectFacility(facility.id));
      marker.addTo(layer);
    });
    if (mappable.length > 0) {
      map.fitBounds(mappable.map((facility) => [facility.latitude, facility.longitude] as [number, number]), { padding: [24, 24] });
    }
  };

  useEffect(() => {
    let disposed = false;
    const handleOffline = () => setMapStatus('offline');
    const handleOnline = () => setMapStatus((current) => current === 'offline' ? 'ready' : current);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    void import('leaflet').then((module) => {
      if (disposed || !containerRef.current) {
        return;
      }
      const L = module.default ?? module;
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true });
      const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      });
      tiles.on('tileerror', () => {
        if (!disposed) {
          setMapStatus('tile-error');
        }
      });
      tiles.addTo(map);
      refs.current = { map, layer: L.layerGroup().addTo(map), leaflet: L };
      setMapStatus((current) => current === 'offline' || current === 'tile-error' ? current : 'ready');
      drawMarkers();
      window.setTimeout(() => map.invalidateSize(), 0);
    }).catch(() => {
      if (!disposed) {
        setMapStatus('unavailable');
      }
    });
    return () => {
      disposed = true;
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      refs.current.map?.remove();
      refs.current = { map: null, layer: null, leaflet: null };
    };
  }, []);

  useEffect(() => {
    drawMarkers();
  }, [facilities, selectedId]);

  return (
    <div className="parking-map-page">
      <header className="page-heading"><h1>{messages.parkingMap}</h1><p>{messages.parkingSourceNote}</p></header>
      <div className="parking-map-shell">
        <div className="parking-map" ref={containerRef} role="region" aria-label="OpenStreetMap 泊車地圖" />
        {mapStatus === 'unavailable' ? <p className="map-status-banner" role="status">地圖暫時無法使用；仍可從下方列表選取停車場。</p> : null}
        {mapStatus === 'offline' ? <p className="map-status-banner" role="status">目前離線，地圖圖磚暫不可用。</p> : null}
        {mapStatus === 'tile-error' ? <p className="map-status-banner" role="status">地圖圖磚未能載入；停車場列表仍可查看。</p> : null}
      </div>
      <section className="parking-map-selection" aria-label="選取停車場">
        {facilities.map((facility) => (
          <button key={facility.id} type="button" className={selectedId === facility.id ? 'is-selected' : ''} aria-pressed={selectedId === facility.id} aria-label={`選取${facility.name}`} onClick={() => onSelectFacility(facility.id)}>
            <span>{facility.name}</span>
            <strong>{displayParkingSpace(facility.spaces.car, facility.suspended)}</strong>
          </button>
        ))}
      </section>
    </div>
  );
}
