import { useCallback, useEffect, useMemo, useState } from 'react';

import type { CatalogRepository } from '../data/catalog-repository';
import { createCatalogRepository, loadCatalog } from '../data/catalog-repository';
import { getCurrentPositionOnce } from '../infra/geolocation';
import { createRealtimeApiClient } from '../infra/api-client';
import { createLocalPreferences, type LocalPreferences, type Theme } from '../infra/local-preferences';
import type { TransitCatalog } from '../../shared/transit-contract';
import { AppShell } from '../components/AppShell';
import { StateMessage } from '../components/StateMessage';
import { messages } from '../i18n/messages';
import { parseRoute, navigateTo, type AppRoute, type AppTab } from './router';
import { HomePage } from '../features/home/HomePage';
import { RouteDirectoryPage } from '../features/routes/RouteDirectoryPage';
import { RoutePage } from '../features/routes/RoutePage';
import { SettingsPage } from '../features/settings/SettingsPage';

export interface AppProps {
  loadCatalogData?: () => Promise<TransitCatalog>;
  preferences?: LocalPreferences;
}

function defaultCatalogLoader(): Promise<TransitCatalog> {
  return loadCatalog('/data/catalog.json');
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

export function App({ loadCatalogData = defaultCatalogLoader, preferences: providedPreferences }: AppProps) {
  const preferences = useMemo(() => providedPreferences ?? createLocalPreferences(), [providedPreferences]);
  const realtimeClient = useMemo(() => createRealtimeApiClient(), []);
  const [catalogState, setCatalogState] = useState<{ status: 'loading' | 'ready' | 'error'; catalog: TransitCatalog | null }>({ status: 'loading', catalog: null });
  const [appRoute, setAppRoute] = useState<AppRoute>(() => parseRoute());
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
    const handlePopState = () => setAppRoute(parseRoute());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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
  const openRoute = useCallback((routeId: string) => {
    navigateTo({ tab: 'routes', routeId });
  }, []);
  const openMapRoute = useCallback((routeId: string) => {
    navigateTo({ tab: 'map', routeId });
  }, []);
  const changeTab = useCallback((tab: AppTab) => {
    navigateTo((tab === 'routes' || tab === 'map') && appRoute.routeId ? { tab, routeId: appRoute.routeId } : { tab });
  }, [appRoute.routeId]);
  const handleThemeChange = (nextTheme: Theme) => {
    const next = preferences.setTheme(nextTheme);
    setTheme(next.theme);
  };

  const selectedRouteId = appRoute.routeId;
  const routeDetail = (appRoute.tab === 'routes' || appRoute.tab === 'map') && selectedRouteId !== undefined && repository !== null;
  return (
    <AppShell activeTab={appRoute.tab} onTabChange={changeTab} showHeader={!routeDetail}>
      {catalogState.status === 'loading' ? <StateMessage kind="loading">{messages.catalogLoading}</StateMessage> : null}
      {catalogState.status === 'error' ? <CatalogError /> : null}
      {catalogState.status === 'ready' && repository && catalogState.catalog ? (
        routeDetail ? (
          <RoutePage
            key={selectedRouteId}
            routeId={selectedRouteId ?? ''}
            catalog={catalogState.catalog}
            repository={repository}
            preferences={preferences}
            realtimeClient={realtimeClient}
            getCurrentPosition={getCurrentPositionOnce}
            onBack={() => navigateTo({ tab: appRoute.tab === 'map' ? 'map' : 'routes' })}
          />
        ) : appRoute.tab === 'nearby' ? (
          <HomePage catalog={catalogState.catalog} repository={repository} preferences={preferences} onOpenRoute={openRoute} getCurrentPosition={getCurrentPositionOnce} />
        ) : appRoute.tab === 'routes' ? (
          <RouteDirectoryPage catalog={catalogState.catalog} preferences={preferences} onOpenRoute={openRoute} title={messages.routeDirectory} emptyCopy="找不到符合的路線。" />
        ) : appRoute.tab === 'map' ? (
          <RouteDirectoryPage catalog={catalogState.catalog} preferences={preferences} onOpenRoute={openMapRoute} title={messages.mapPickerTitle} emptyCopy="暫時沒有可顯示的路線。" />
        ) : appRoute.tab === 'favorites' ? (
          <RouteDirectoryPage catalog={catalogState.catalog} preferences={preferences} onOpenRoute={openRoute} onlyFavorites title={messages.favoritesRoutes} />
        ) : (
          <SettingsPage preferences={preferences} onThemeChange={handleThemeChange} />
        )
      ) : null}
    </AppShell>
  );
}
