import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CatalogRepository } from '../data/catalog-repository';
import { createCatalogRepository, loadCatalog } from '../data/catalog-repository';
import { getCurrentPositionOnce, type CurrentPosition } from '../infra/geolocation';
import { createRealtimeApiClient } from '../infra/api-client';
import { createArrivalsClient } from '../infra/arrivals-client';
import { createPushClient } from '../infra/push-client';
import { createLocalPreferences, type AppMode, type LocalPreferences, type Theme } from '../infra/local-preferences';
import { createParkingApiClient, type ParkingApiClient } from '../infra/parking-client';
import type { DirectionId, TransitCatalog } from '../../shared/transit-contract';
import { AppShell } from '../components/AppShell';
import { StateMessage } from '../components/StateMessage';
import { messages } from '../i18n/messages';
import { parseRoute, navigateTo, type AppRoute, type AppTab } from './router';
import { HomePage } from '../features/home/HomePage';
import { RouteDirectoryPage } from '../features/routes/RouteDirectoryPage';
import { RoutePage } from '../features/routes/RoutePage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { ParkingModePage } from '../features/parking/ParkingModePage';
import { ParkingSettingsControls } from '../features/parking/ParkingSettingsControls';
import type { ParkingFacility } from '../../shared/parking-contract';

export interface AppProps {
  loadCatalogData?: () => Promise<TransitCatalog>;
  preferences?: LocalPreferences;
  parkingClient?: ParkingApiClient;
  getCurrentPosition?: () => Promise<CurrentPosition>;
  onParkingAlertRequest?: (facility: ParkingFacility) => void;
}

export function resolveCatalogUrl(baseUrl: string = import.meta.env.BASE_URL): string {
  const normalizedBase = baseUrl.trim() || '/';
  return `${normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`}data/catalog.json`;
}

function defaultCatalogLoader(): Promise<TransitCatalog> {
  return loadCatalog(resolveCatalogUrl());
}

function resolvedTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') {
    return theme;
  }
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function CatalogError() {
  return (
    <div className="catalog-state">
      <h1>{messages.catalogMissingTitle}</h1>
      <p>{messages.catalogMissingBody}</p>
      <code>{messages.catalogSyncCommand}</code>
    </div>
  );
}

export function App({ loadCatalogData = defaultCatalogLoader, preferences: providedPreferences, parkingClient: providedParkingClient, getCurrentPosition = getCurrentPositionOnce, onParkingAlertRequest }: AppProps) {
  const preferences = useMemo(() => providedPreferences ?? createLocalPreferences(), [providedPreferences]);
  const realtimeClient = useMemo(() => createRealtimeApiClient(), []);
  const arrivalsClient = useMemo(() => createArrivalsClient(), []);
  const pushClient = useMemo(() => createPushClient(), []);
  const parkingClient = useMemo(() => providedParkingClient ?? createParkingApiClient(), [providedParkingClient]);
  const [catalogState, setCatalogState] = useState<{ status: 'loading' | 'ready' | 'error'; catalog: TransitCatalog | null }>({ status: 'loading', catalog: null });
  const [activeModePreference, setActiveModePreference] = useState<AppMode | null>(() => preferences.getActiveMode());
  const [appRoute, setAppRoute] = useState<AppRoute>(() => parseRoute(window.location, preferences.getActiveMode() ?? 'bus'));
  const lastRoutesByMode = useRef<Partial<Record<AppMode, AppRoute>>>({});
  const [theme, setTheme] = useState<Theme>(() => preferences.getTheme());

  useEffect(() => {
    let active = true;
    setCatalogState({ status: 'loading', catalog: null });
    void loadCatalogData()
      .then((catalog) => {
        if (active) {
          setCatalogState({ status: 'ready', catalog });
        }
      })
      .catch(() => {
        if (active) {
          setCatalogState({ status: 'error', catalog: null });
        }
      });
    return () => {
      active = false;
    };
  }, [loadCatalogData]);

  useEffect(() => {
    const handlePopState = () => setAppRoute(parseRoute(window.location, activeModePreference ?? 'bus'));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeModePreference]);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => root.dataset.theme = resolvedTheme(theme);
    apply();
    if (theme !== 'system' || !globalThis.matchMedia) {
      return undefined;
    }
    const media = globalThis.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => apply();
    media.addEventListener?.('change', handleChange);
    return () => media.removeEventListener?.('change', handleChange);
  }, [theme]);

  const repository = useMemo<CatalogRepository | null>(
    () => catalogState.catalog ? createCatalogRepository(catalogState.catalog) : null,
    [catalogState.catalog],
  );
  const openRoute = useCallback((routeId: string, directionId?: DirectionId) => {
    navigateTo(directionId === undefined ? { tab: 'routes', routeId } : { tab: 'routes', routeId, directionId });
  }, []);
  const openMapRoute = useCallback((routeId: string, directionId?: DirectionId) => {
    navigateTo(directionId === undefined ? { tab: 'map', routeId } : { tab: 'map', routeId, directionId });
  }, []);
  const activeMode: AppMode = appRoute.mode ?? activeModePreference ?? 'bus';
  const changeMode = useCallback((nextMode: AppMode) => {
    const next = preferences.setActiveMode(nextMode);
    setActiveModePreference(next.activeMode);
    lastRoutesByMode.current[activeMode] = appRoute;
    const remembered = lastRoutesByMode.current[nextMode];
    if (remembered) {
      navigateTo(nextMode === 'bus' && remembered.mode === undefined ? { ...remembered, mode: 'bus' } : remembered, true);
      return;
    }
    navigateTo(nextMode === 'parking' ? { mode: 'parking', tab: 'nearby' } : { mode: 'bus', tab: 'nearby' }, true);
  }, [activeMode, appRoute, preferences]);
  const changeTab = useCallback((tab: AppTab) => {
    if (activeMode === 'parking') {
      const nextRoute: AppRoute = { mode: 'parking', tab };
      lastRoutesByMode.current.parking = nextRoute;
      navigateTo(nextRoute);
      return;
    }
    const nextRoute = (tab === 'routes' || tab === 'map') && appRoute.routeId
      ? appRoute.directionId === undefined
        ? { tab, routeId: appRoute.routeId }
        : { tab, routeId: appRoute.routeId, directionId: appRoute.directionId }
      : { tab };
    lastRoutesByMode.current.bus = nextRoute;
    navigateTo(nextRoute);
  }, [activeMode, appRoute.directionId, appRoute.routeId]);
  const handleThemeChange = (nextTheme: Theme) => {
    const next = preferences.setTheme(nextTheme);
    setTheme(next.theme);
  };

  const selectedRouteId = appRoute.routeId;
  const routeDetail = activeMode === 'bus' && (appRoute.tab === 'routes' || appRoute.tab === 'map') && selectedRouteId !== undefined && repository !== null;
  const parkingDetail = activeMode === 'parking' && appRoute.parkingId !== undefined;
  return (
    <AppShell activeMode={activeMode} activeModePreference={activeModePreference} activeTab={appRoute.tab} onTabChange={changeTab} onModeChange={changeMode} showHeader={!routeDetail && !parkingDetail}>
      {activeMode === 'bus' && catalogState.status === 'loading' ? <StateMessage kind="loading">{messages.catalogLoading}</StateMessage> : null}
      {activeMode === 'bus' && catalogState.status === 'error' ? <CatalogError /> : null}
      {activeMode === 'parking' ? (
        appRoute.tab === 'settings' ? (
          <>
            <SettingsPage preferences={preferences} onThemeChange={handleThemeChange} pushClient={pushClient} />
            <ParkingSettingsControls preferences={preferences} />
          </>
        ) : (
          <ParkingModePage
            tab={appRoute.tab}
            {...(appRoute.parkingId === undefined ? {} : { parkingId: appRoute.parkingId })}
            {...(appRoute.query === undefined ? {} : { query: appRoute.query })}
            client={parkingClient}
            preferences={preferences}
            getCurrentPosition={getCurrentPosition}
            onOpenDetail={(parkingId) => navigateTo({ mode: 'parking', tab: 'detail', parkingId, ...(appRoute.query === undefined ? {} : { query: appRoute.query }) })}
            onBack={() => navigateTo({ mode: 'parking', tab: appRoute.query ? 'search' : 'nearby', ...(appRoute.query === undefined ? {} : { query: appRoute.query }) })}
            {...(onParkingAlertRequest === undefined ? {} : { onRequestAlert: onParkingAlertRequest })}
          />
        )
      ) : catalogState.status === 'ready' && repository && catalogState.catalog ? (
        routeDetail ? (
          <RoutePage
            key={`${selectedRouteId}-${appRoute.directionId ?? 'default'}`}
            routeId={selectedRouteId ?? ''}
            catalog={catalogState.catalog}
            repository={repository}
            preferences={preferences}
            realtimeClient={realtimeClient}
            {...(appRoute.directionId === undefined ? {} : { initialDirectionId: appRoute.directionId })}
            onDirectionChange={(directionId) => navigateTo({ tab: appRoute.tab, routeId: selectedRouteId, directionId }, true)}
            pushClient={pushClient}
            getCurrentPosition={getCurrentPositionOnce}
            onBack={() => navigateTo({ tab: appRoute.tab === 'map' ? 'map' : 'routes' })}
          />
        ) : appRoute.tab === 'nearby' ? (
          <HomePage catalog={catalogState.catalog} repository={repository} preferences={preferences} onOpenRoute={openRoute} getCurrentPosition={getCurrentPositionOnce} arrivalsClient={arrivalsClient} />
        ) : appRoute.tab === 'routes' ? (
          <RouteDirectoryPage catalog={catalogState.catalog} preferences={preferences} onOpenRoute={openRoute} title={messages.routeDirectory} emptyCopy="找不到符合的路線。" />
        ) : appRoute.tab === 'map' ? (
          <RouteDirectoryPage catalog={catalogState.catalog} preferences={preferences} onOpenRoute={openMapRoute} title={messages.mapPickerTitle} emptyCopy="暫時沒有可顯示的路線。" />
        ) : appRoute.tab === 'favorites' ? (
          <RouteDirectoryPage catalog={catalogState.catalog} preferences={preferences} onOpenRoute={openRoute} onlyFavorites title={messages.favoritesRoutes} />
        ) : (
          <>
            <SettingsPage preferences={preferences} onThemeChange={handleThemeChange} pushClient={pushClient} />
            <ParkingSettingsControls preferences={preferences} />
          </>
        )
      ) : null}
    </AppShell>
  );
}
