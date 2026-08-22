import { ArrowLeft, BusFront, ChevronRight, Star } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';

import type { CatalogRepository } from '../../data/catalog-repository';
import { estimateEtaMinutes } from '../../domain/eta';
import { getCurrentPositionOnce, type CurrentPosition } from '../../infra/geolocation';
import type { LocalPreferences } from '../../infra/local-preferences';
import type { DirectionId, RealtimeBus, RouteDirection, TransitCatalog } from '../../../shared/transit-contract';
import { messages } from '../../i18n/messages';
import { StateMessage } from '../../components/StateMessage';
import { useRealtimePolling, type RealtimeClientLike } from './useRealtimePolling';

const LazyRouteMap = lazy(() => import('../map/RouteMap'));
const LazyDevDebugPanel = import.meta.env.DEV ? lazy(() => import('./dev-debug')) : null;

export interface RoutePageProps {
  routeId: string;
  catalog: TransitCatalog;
  repository: CatalogRepository;
  preferences: LocalPreferences;
  realtimeClient: RealtimeClientLike;
  onBack: () => void;
  getCurrentPosition?: () => Promise<CurrentPosition>;
  showMap?: boolean;
  devMode?: boolean;
}

export function isDebugPanelEnabled(devMode: boolean, environmentDev = import.meta.env.DEV): boolean {
  return environmentDev && devMode;
}

function nextStop(direction: RouteDirection, stationCode: string, repository: CatalogRepository) {
  const index = direction.stopIds.indexOf(stationCode.trim());
  const nextId = index >= 0 ? direction.stopIds[index + 1] : undefined;
  return nextId ? repository.catalog.stops.find((stop) => stop.id === nextId) : undefined;
}

function stationForBus(bus: RealtimeBus, repository: CatalogRepository) {
  return repository.catalog.stops.find((stop) => stop.id === bus.stationCode.trim());
}

export function RoutePage({
  routeId,
  catalog,
  repository,
  preferences,
  realtimeClient,
  onBack,
  getCurrentPosition = getCurrentPositionOnce,
  showMap = true,
  devMode = import.meta.env.DEV,
}: RoutePageProps) {
  const route = repository.getRoute(routeId);
  const [directionId, setDirectionId] = useState<DirectionId>(route?.directions.some((direction) => direction.id === 0) ? 0 : 1);
  const direction = route?.directions.find((candidate) => candidate.id === directionId) ?? route?.directions[0];
  const [activeTab, setActiveTab] = useState<'realtime' | 'stops'>('realtime');
  const [favorite, setFavorite] = useState(() => preferences.getFavorites().includes(routeId));
  const [userPosition, setUserPosition] = useState<CurrentPosition | null>(null);
  const [locationMessage, setLocationMessage] = useState('');

  const polling = useRealtimePolling(route?.id ?? routeId, direction?.id ?? 0, realtimeClient, { enabled: Boolean(route && direction) });
  const buses = polling.data?.buses ?? [];
  const stops = useMemo(
    () => (direction?.stopIds ?? []).flatMap((stopId) => {
      const stop = repository.catalog.stops.find((candidate) => candidate.id === stopId);
      return stop ? [stop] : [];
    }),
    [direction?.stopIds, repository],
  );

  const currentStationNames = useMemo(() => new Map(stops.map((stop) => [stop.id, stop.nameCn])), [stops]);

  if (!route || !direction) {
    return (
      <div className="route-page route-not-found">
        <button className="back-button" type="button" onClick={onBack}><ArrowLeft aria-hidden="true" size={25} />{messages.back}</button>
        <StateMessage kind="error">找不到此路線。</StateMessage>
      </div>
    );
  }

  const requestLocation = async () => {
    setLocationMessage('');
    try {
      setUserPosition(await getCurrentPosition());
    } catch {
      setLocationMessage('無法取得目前位置；地圖仍可正常查看路線。');
    }
  };

  const toggleFavorite = () => {
    const next = preferences.toggleFavorite(route.id);
    setFavorite(next.favorites.includes(route.id));
  };

  return (
    <div className="route-page">
      <header className="route-heading">
        <button className="icon-button route-back" type="button" aria-label={messages.back} onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={29} strokeWidth={1.8} />
        </button>
        <div className="route-title">
          <span className="route-number" aria-label={`路線 ${route.id}`}>路線 {route.id}</span>
          <h1>{route.displayName}</h1>
          <p>{direction.name}</p>
          <span><BusFront aria-hidden="true" size={24} strokeWidth={1.8} />{route.operator}</span>
        </div>
        <button className={`icon-button route-favorite${favorite ? ' is-favorite' : ''}`} type="button" aria-label={messages.favoriteRoute(route.id)} aria-pressed={favorite} onClick={toggleFavorite}>
          <Star aria-hidden="true" size={28} fill={favorite ? 'currentColor' : 'none'} strokeWidth={1.8} />
        </button>
      </header>

      <div className="direction-tabs" role="tablist" aria-label={messages.direction}>
        {route.directions.map((candidate) => (
          <button
            type="button"
            role="tab"
            key={candidate.id}
            id={`direction-tab-${candidate.id}`}
            aria-controls="direction-panel"
            aria-selected={candidate.id === direction.id}
            className={candidate.id === direction.id ? 'is-selected' : ''}
            onClick={() => setDirectionId(candidate.id)}
          >
            {candidate.name}
          </button>
        ))}
      </div>

      <div className="direction-panel" role="tabpanel" id="direction-panel" aria-labelledby={`direction-tab-${direction.id}`} tabIndex={0}>
        {showMap ? (
          <section className="map-section" aria-label={messages.routeMap}>
            <Suspense fallback={<div className="map-placeholder">正在載入地圖…</div>}>
              <LazyRouteMap
                stops={stops}
                buses={buses}
                userPosition={userPosition}
                onRequestLocation={() => void requestLocation()}
              />
            </Suspense>
            {locationMessage ? <p className="map-location-message">{locationMessage}</p> : null}
          </section>
        ) : null}

        <div className="route-data-tabs" role="tablist" aria-label="路線資料">
          <button type="button" role="tab" id="realtime-tab" aria-controls="realtime-panel" aria-selected={activeTab === 'realtime'} className={activeTab === 'realtime' ? 'is-selected' : ''} onClick={() => setActiveTab('realtime')}>
            {messages.realtime}
          </button>
          <button type="button" role="tab" id="stops-tab" aria-controls="stops-panel" aria-selected={activeTab === 'stops'} className={activeTab === 'stops' ? 'is-selected' : ''} onClick={() => setActiveTab('stops')}>
            {messages.stops}
          </button>
        </div>

        {activeTab === 'realtime' ? (
          <RealtimePanel
            routeId={route.id}
            directionId={direction.id}
            direction={direction}
            buses={buses}
            status={polling.status}
            data={polling.data}
            repository={repository}
            catalog={catalog}
            onRefresh={polling.refresh}
            devMode={devMode}
            stationNames={currentStationNames}
          />
        ) : (
          <StopsPanel direction={direction} buses={buses} stationNames={currentStationNames} />
        )}
      </div>
      <p className="route-source-note">{messages.sourceNote}</p>
    </div>
  );
}

interface RealtimePanelProps {
  routeId: string;
  directionId: DirectionId;
  direction: RouteDirection;
  buses: RealtimeBus[];
  status: ReturnType<typeof useRealtimePolling>['status'];
  data: ReturnType<typeof useRealtimePolling>['data'];
  repository: CatalogRepository;
  catalog: TransitCatalog;
  onRefresh: () => void;
  devMode: boolean;
  stationNames: Map<string, string>;
}

function RealtimePanel({ routeId, directionId, direction, buses, status, data, repository, catalog, onRefresh, devMode, stationNames }: RealtimePanelProps) {
  return (
    <section className="realtime-panel" role="tabpanel" id="realtime-panel" aria-labelledby="realtime-tab" aria-label={messages.realtime} aria-live="polite" tabIndex={0}>
      {!data && status === 'loading' ? <StateMessage kind="loading">{messages.loadingRealtime}</StateMessage> : null}
      {!data && status === 'error' ? <StateMessage kind="error" actionLabel={messages.refresh} onAction={onRefresh}>{messages.realtimeUnavailable}</StateMessage> : null}
      {!data && status !== 'loading' && status !== 'error' ? <StateMessage kind="empty">{messages.realtimeUnavailable}</StateMessage> : null}
      {data ? (
        <>
          {status === 'error' ? <StateMessage kind="error" actionLabel={messages.refresh} onAction={onRefresh}>{messages.realtimeUnavailable}</StateMessage> : null}
          {data.stale ? <p className="stale-message">{messages.stale(data.ageSeconds)}</p> : null}
          {buses.length > 0 ? buses.map((bus, index) => (
            <BusObservation
              key={`${bus.plate}-${bus.stationCode}-${index}`}
              bus={bus}
              routeId={routeId}
              directionId={directionId}
              direction={direction}
              repository={repository}
              catalog={catalog}
              stationNames={stationNames}
            />
          )) : <p className="empty-copy">目前沒有觀測中的巴士。</p>}
          {import.meta.env.DEV && devMode && LazyDevDebugPanel ? (
            <Suspense fallback={null}>
              <LazyDevDebugPanel routeId={routeId} directionId={directionId} data={data} />
            </Suspense>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

interface BusObservationProps {
  bus: RealtimeBus;
  routeId: string;
  directionId: DirectionId;
  direction: RouteDirection;
  repository: CatalogRepository;
  catalog: TransitCatalog;
  stationNames: Map<string, string>;
}

function BusObservation({ bus, routeId, directionId, direction, repository, catalog, stationNames }: BusObservationProps) {
  const station = stationForBus(bus, repository);
  const target = nextStop(direction, bus.stationCode, repository);
  const eta = target
    ? estimateEtaMinutes({ catalog, realtime: {
      route: routeId,
      direction: directionId,
      updatedAt: new Date().toISOString(),
      ageSeconds: 0,
      stale: false,
      source: 'DSAT observation',
      buses: [bus],
    }, targetStopId: target.id, observationStationCode: bus.stationCode })
    : null;
  const stationName = station?.nameCn ?? stationNames.get(bus.stationCode) ?? bus.stationCode;

  return (
    <article className="bus-observation">
      <BusFront aria-hidden="true" className="bus-observation-icon" size={35} strokeWidth={1.8} />
      <div className="bus-observation-copy">
        <strong>{bus.plate.trim() || '未提供車牌'}</strong>
        <span>目前：{bus.stationCode} {stationName}</span>
        <span className="estimated-label">{messages.estimatedPosition}</span>
        <span className="eta-label">{eta === null ? messages.etaUnavailable : `約 ${eta} 分鐘到 ${target?.nameCn ?? ''}`}</span>
      </div>
      <div className="bus-observation-speed">
        <span>{bus.speedKph === null ? '—' : bus.speedKph} km/h</span>
        <ChevronRight aria-hidden="true" size={24} strokeWidth={1.8} />
      </div>
    </article>
  );
}

interface StopsPanelProps {
  direction: RouteDirection;
  buses: RealtimeBus[];
  stationNames: Map<string, string>;
}

function StopsPanel({ direction, buses, stationNames }: StopsPanelProps) {
  const observed = new Set(buses.map((bus) => bus.stationCode));
  return (
    <section className="stops-panel" role="tabpanel" id="stops-panel" aria-labelledby="stops-tab" aria-label={messages.stops} tabIndex={0}>
      {direction.stopIds.map((stopId, index) => (
        <div className={`route-stop-row${observed.has(stopId) ? ' is-observed' : ''}`} key={stopId}>
          <span className="route-stop-index">{index + 1}</span>
          <span className="route-stop-line" aria-hidden="true" />
          <span className="route-stop-copy"><strong>{stopId}</strong><span>{stationNames.get(stopId) ?? stopId}</span></span>
          {observed.has(stopId) ? <span className="observed-label">有觀測</span> : null}
        </div>
      ))}
    </section>
  );
}
