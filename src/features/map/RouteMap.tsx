import { LocateFixed, BusFront } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useEffect, useRef } from 'react';
import { useState } from 'react';
import type * as Leaflet from 'leaflet';
import type { LayerGroup, Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { BusStop, RealtimeBus } from '../../../shared/transit-contract';
import type { CurrentPosition } from '../../infra/geolocation';
import { messages } from '../../i18n/messages';

interface RouteMapProps {
  stops: BusStop[];
  buses: RealtimeBus[];
  userPosition: CurrentPosition | null;
  onRequestLocation: () => void;
}

interface MapRefs {
  map: LeafletMap | null;
  layerGroup: LayerGroup | null;
  leaflet: typeof Leaflet | null;
  fitted: boolean;
}

/** Imperative Leaflet is isolated in this lazy module so the app shell stays small. */
export default function RouteMap({ stops, buses, userPosition, onRequestLocation }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const refs = useRef<MapRefs>({ map: null, layerGroup: null, leaflet: null, fitted: false });
  const propsRef = useRef({ stops, buses, userPosition });
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'unavailable' | 'offline' | 'tile-error'>(
    () => (typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'loading'),
  );
  propsRef.current = { stops, buses, userPosition };

  const drawLayers = () => {
    const { map, layerGroup, leaflet: L } = refs.current;
    if (!map || !layerGroup || !L) {
      return;
    }
    layerGroup.clearLayers();
    const current = propsRef.current;
    const stopLatLngs = current.stops.map((stop) => {
      const [longitude, latitude] = stop.coordinates;
      return [latitude, longitude] as [number, number];
    });
    if (stopLatLngs.length > 1) {
      L.polyline(stopLatLngs, { color: '#008765', weight: 4, opacity: 0.96 }).addTo(layerGroup);
    }
    current.stops.forEach((stop, index) => {
      const [longitude, latitude] = stop.coordinates;
      L.circleMarker([latitude, longitude], {
        radius: index === 0 || index === current.stops.length - 1 ? 7 : 5,
        color: '#008765',
        weight: 3,
        fillColor: '#ffffff',
        fillOpacity: 1,
      }).bindTooltip(stop.nameCn, { direction: 'top', offset: [0, -5] }).addTo(layerGroup);
    });
    current.buses.forEach((bus) => {
      const stop = current.stops.find((candidate) => candidate.id === bus.stationCode.trim());
      if (!stop) {
        return;
      }
      const [longitude, latitude] = stop.coordinates;
      L.marker([latitude, longitude], {
        icon: L.divIcon({
          className: 'map-bus-marker-wrap',
          html: `<span class="map-bus-marker" role="img" aria-label="推算位置">${renderToStaticMarkup(<BusFront aria-hidden="true" size={20} strokeWidth={2} />)}</span>`,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        }),
      }).bindTooltip(messages.estimatedPosition, { direction: 'top', offset: [0, -15] }).addTo(layerGroup);
    });
    if (current.userPosition) {
      L.circleMarker([current.userPosition.latitude, current.userPosition.longitude], {
        radius: 7,
        color: '#1f2937',
        weight: 2,
        fillColor: '#ffffff',
        fillOpacity: 1,
      }).bindTooltip('目前位置', { direction: 'top', offset: [0, -7] }).addTo(layerGroup);
    }
    if (!refs.current.fitted && stopLatLngs.length > 0) {
      map.fitBounds(stopLatLngs, { padding: [24, 24] });
      refs.current.fitted = true;
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
      refs.current.map = map;
      refs.current.layerGroup = L.layerGroup().addTo(map);
      refs.current.leaflet = L;
      setMapStatus((current) => current === 'offline' || current === 'tile-error' ? current : 'ready');
      drawLayers();
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
      refs.current.map = null;
      refs.current.layerGroup = null;
      refs.current.leaflet = null;
    };
  }, []);

  useEffect(() => {
    drawLayers();
  }, [stops, buses, userPosition]);

  return (
    <div className="route-map-shell">
      <div className="route-map" ref={containerRef} role="region" aria-label="OpenStreetMap 路線地圖" />
      {mapStatus === 'unavailable' ? <p className="map-status-banner" role="status" aria-live="polite">地圖暫時無法使用；路線及站點資料仍可查看。</p> : null}
      {mapStatus === 'offline' ? <p className="map-status-banner" role="status" aria-live="polite">目前離線，地圖圖磚暫不可用；路線及站點資料仍可查看。</p> : null}
      {mapStatus === 'tile-error' ? <p className="map-status-banner" role="status" aria-live="polite">地圖圖磚未能載入；路線及站點資料仍可查看。</p> : null}
      <div className="map-legend" aria-label="地圖圖例">
        <span className="legend-line" aria-hidden="true" />
        <span className="legend-dot" aria-hidden="true" />
        <span>{messages.estimatedPosition}</span>
      </div>
      <button className="map-location-button" type="button" aria-label={messages.useLocation} onClick={onRequestLocation}>
        <LocateFixed aria-hidden="true" size={22} strokeWidth={1.8} />
      </button>
    </div>
  );
}
