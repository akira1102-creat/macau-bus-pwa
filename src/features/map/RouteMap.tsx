import { LocateFixed } from 'lucide-react';
import { useEffect, useRef } from 'react';
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
          html: '<span class="map-bus-marker" aria-label="推算位置">▣</span>',
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
    void import('leaflet').then((module) => {
      if (disposed || !containerRef.current) {
        return;
      }
      const L = module.default ?? module;
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
      refs.current.map = map;
      refs.current.layerGroup = L.layerGroup().addTo(map);
      refs.current.leaflet = L;
      drawLayers();
      window.setTimeout(() => map.invalidateSize(), 0);
    }).catch(() => {
      // The visible fallback remains useful when a browser blocks dynamic map assets.
    });
    return () => {
      disposed = true;
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
      <div className="route-map" ref={containerRef} aria-label="OpenStreetMap 路線地圖" />
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
