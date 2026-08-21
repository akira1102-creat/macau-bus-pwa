import { LocateFixed, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { CatalogRepository } from '../../data/catalog-repository';
import { findNearbyStops, type NearbyStop } from '../../domain/nearby';
import { getCurrentPositionOnce, type CurrentPosition } from '../../infra/geolocation';
import type { LocalPreferences, Preferences } from '../../infra/local-preferences';
import type { RouteSummary, TransitCatalog } from '../../../shared/transit-contract';
import { messages } from '../../i18n/messages';
import { RouteListItem } from '../../components/RouteListItem';
import { StateMessage } from '../../components/StateMessage';
import { StopListItem } from '../../components/StopListItem';

export interface HomePageProps {
  catalog: TransitCatalog;
  repository: CatalogRepository;
  preferences: LocalPreferences;
  onOpenRoute: (routeId: string) => void;
  getCurrentPosition?: () => Promise<CurrentPosition>;
}

function routeMatches(route: RouteSummary, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return false;
  }
  return [route.id, route.name, route.displayName, route.operator, ...route.directions.map((direction) => direction.name)]
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

function locationErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'permission-denied') {
    return messages.locationDenied;
  }
  if (code === 'unsupported') {
    return messages.locationUnsupported;
  }
  return messages.locationUnavailable;
}

function refreshPreferences(preferences: LocalPreferences): Preferences {
  return preferences.get();
}

export function HomePage({ catalog, repository, preferences, onOpenRoute, getCurrentPosition = getCurrentPositionOnce }: HomePageProps) {
  const [query, setQuery] = useState('');
  const [preferenceState, setPreferenceState] = useState<Preferences>(() => refreshPreferences(preferences));
  const [nearbyStops, setNearbyStops] = useState<NearbyStop[]>([]);
  const [nearbyRadius, setNearbyRadius] = useState<300 | 500 | 1_000>(500);
  const [nearbyState, setNearbyState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [nearbyError, setNearbyError] = useState('');
  const [position, setPosition] = useState<CurrentPosition | null>(null);

  const searchRoutes = useMemo(
    () => catalog.routes.filter((route) => routeMatches(route, query)),
    [catalog.routes, query],
  );
  const searchStops = useMemo(() => (query.trim() ? repository.searchStops(query).slice(0, 10) : []), [query, repository]);
  const favoriteRoutes = useMemo(
    () => preferenceState.favorites.flatMap((id) => {
      const route = repository.getRoute(id);
      return route ? [route] : [];
    }),
    [preferenceState.favorites, repository],
  );
  const recentRoutes = useMemo(
    () => preferenceState.recent.flatMap((id) => {
      const route = repository.getRoute(id);
      return route ? [route] : [];
    }),
    [preferenceState.recent, repository],
  );

  const openRoute = (routeId: string) => {
    setPreferenceState(preferences.addRecent(routeId));
    onOpenRoute(routeId);
  };

  const toggleFavorite = (routeId: string) => {
    setPreferenceState(preferences.toggleFavorite(routeId));
  };

  const locate = async () => {
    setNearbyState('loading');
    setNearbyError('');
    try {
      const nextPosition = await getCurrentPosition();
      setPosition(nextPosition);
      setNearbyStops(findNearbyStops(catalog, nextPosition, nearbyRadius));
      setNearbyState('ready');
    } catch (error) {
      setPosition(null);
      setNearbyStops([]);
      setNearbyError(locationErrorMessage(error));
      setNearbyState('error');
    }
  };

  const changeRadius = (radius: 300 | 500 | 1_000) => {
    setNearbyRadius(radius);
    if (position) {
      setNearbyStops(findNearbyStops(catalog, position, radius));
    }
  };

  return (
    <div className="home-page">
      <label className="search-field">
        <Search aria-hidden="true" size={25} strokeWidth={1.8} />
        <span className="sr-only">搜尋路線或巴士站</span>
        <input
          type="search"
          aria-label={messages.searchPlaceholder}
          placeholder={messages.searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {query.trim() ? (
        <section className="content-section search-results" aria-labelledby="search-results-title">
          <div className="section-heading"><h2 id="search-results-title">搜尋結果</h2><span>{searchRoutes.length + searchStops.length}</span></div>
          {searchRoutes.map((route) => (
            <RouteListItem
              key={`route-${route.id}`}
              route={route}
              favorite={preferenceState.favorites.includes(route.id)}
              onOpen={() => openRoute(route.id)}
              onToggleFavorite={() => toggleFavorite(route.id)}
            />
          ))}
          {searchStops.map((stop) => {
            const routeId = stop.routeIds[0];
            return (
              <StopListItem
                key={`stop-${stop.id}`}
                stop={stop}
                onOpen={routeId ? () => openRoute(routeId) : undefined}
              />
            );
          })}
          {searchRoutes.length === 0 && searchStops.length === 0 ? <p className="empty-copy">找不到符合的路線或巴士站。</p> : null}
        </section>
      ) : null}

      <section className="content-section nearby-section" aria-labelledby="nearby-title">
        <div className="section-heading section-heading-action">
          <h2 id="nearby-title">{messages.nearbyStops}</h2>
          <button className="location-button" type="button" onClick={() => void locate()} disabled={nearbyState === 'loading'}>
            <LocateFixed aria-hidden="true" size={24} strokeWidth={1.8} />
            <span>{messages.useLocation}</span>
          </button>
        </div>
        {nearbyState === 'loading' ? <StateMessage kind="loading">正在取得目前位置…</StateMessage> : null}
        {nearbyState === 'error' ? <StateMessage kind="error">{nearbyError}</StateMessage> : null}
        {nearbyState === 'idle' ? <p className="muted-copy">按「使用目前位置」查看附近站點；位置只會在此裝置計算。</p> : null}
        {nearbyState === 'ready' ? (
          <>
            <div className="radius-tabs" role="group" aria-label="附近範圍">
              {([300, 500, 1_000] as const).map((radius) => (
                <button type="button" key={radius} className={nearbyRadius === radius ? 'is-selected' : ''} onClick={() => changeRadius(radius)}>
                  {messages.locationRadius(radius)}
                </button>
              ))}
            </div>
            {nearbyStops.length > 0 ? nearbyStops.slice(0, 5).map(({ stop, distanceMeters }) => (
              <StopListItem
                key={stop.id}
                stop={stop}
                distanceMeters={distanceMeters}
                onOpen={stop.routeIds[0] ? () => openRoute(stop.routeIds[0] as string) : undefined}
              />
            )) : <p className="empty-copy">此範圍暫時沒有巴士站。</p>}
          </>
        ) : null}
      </section>

      <RouteSection
        title={messages.favoritesRoutes}
        routes={favoriteRoutes}
        preferenceState={preferenceState}
        onOpen={openRoute}
        onToggleFavorite={toggleFavorite}
        emptyCopy={messages.noFavorites}
      />
      <RouteSection
        title={messages.recentRoutes}
        routes={recentRoutes}
        preferenceState={preferenceState}
        onOpen={openRoute}
        onToggleFavorite={toggleFavorite}
        emptyCopy={messages.noRecent}
        compact
      />
    </div>
  );
}

interface RouteSectionProps {
  title: string;
  routes: RouteSummary[];
  preferenceState: Preferences;
  onOpen: (routeId: string) => void;
  onToggleFavorite: (routeId: string) => void;
  emptyCopy: string;
  compact?: boolean;
}

function RouteSection({ title, routes, preferenceState, onOpen, onToggleFavorite, emptyCopy, compact = false }: RouteSectionProps) {
  return (
    <section className="content-section route-section" aria-labelledby={`${title}-title`}>
      <div className="section-heading"><h2 id={`${title}-title`}>{title}</h2></div>
      {routes.length > 0 ? routes.map((route) => (
        <RouteListItem
          key={route.id}
          route={route}
          favorite={preferenceState.favorites.includes(route.id)}
          onOpen={() => onOpen(route.id)}
          onToggleFavorite={() => onToggleFavorite(route.id)}
          compact={compact}
        />
      )) : <p className="muted-copy">{emptyCopy}</p>}
    </section>
  );
}
