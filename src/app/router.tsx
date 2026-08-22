import type { DirectionId } from '../../shared/transit-contract';

import type { AppMode } from '../infra/local-preferences';

export type AppTab = 'nearby' | 'routes' | 'map' | 'search' | 'favorites' | 'settings' | 'detail';

export const BUS_NAVIGATION_TABS = ['nearby', 'routes', 'map', 'favorites', 'settings'] as const;
export const PARKING_NAVIGATION_TABS = ['nearby', 'map', 'search', 'favorites', 'settings'] as const;

export interface AppRoute {
  mode?: AppMode;
  tab: AppTab;
  routeId?: string;
  directionId?: DirectionId;
  parkingId?: string;
  query?: string;
}

function isMode(value: string | null): value is AppMode {
  return value === 'bus' || value === 'parking';
}

function isTab(value: string | null): value is AppTab {
  return value === 'nearby'
    || value === 'routes'
    || value === 'map'
    || value === 'search'
    || value === 'favorites'
    || value === 'settings'
    || value === 'detail';
}

export function getNavigationTabs(mode: AppMode): readonly AppTab[] {
  return mode === 'parking' ? PARKING_NAVIGATION_TABS : BUS_NAVIGATION_TABS;
}

function isValidTabForMode(tab: AppTab, mode: AppMode): boolean {
  return tab === 'detail'
    ? mode === 'parking'
    : getNavigationTabs(mode).includes(tab);
}

function parseDirectionId(value: string | null): DirectionId | undefined {
  if (value === '0') {
    return 0;
  }
  if (value === '1') {
    return 1;
  }
  return undefined;
}

export function parseRoute(location: Location = window.location, preferredMode: AppMode = 'bus'): AppRoute {
  const params = new URLSearchParams(location.search);
  const explicitMode = params.get('mode');
  const mode = isMode(explicitMode) ? explicitMode : preferredMode;
  const tabValue = params.get('tab');
  const tab = isTab(tabValue) && isValidTabForMode(tabValue, mode) ? tabValue : 'nearby';
  const routeId = params.get('route')?.trim() || undefined;
  const directionId = parseDirectionId(params.get('direction'));
  const parkingId = params.get('parking')?.trim() || params.get('parkingId')?.trim() || undefined;
  const query = params.get('q')?.trim() || undefined;
  if (mode === 'parking') {
    return {
      mode: 'parking',
      tab,
      ...(parkingId === undefined ? {} : { parkingId }),
      ...(query === undefined ? {} : { query }),
    };
  }
  if (!routeId) {
    return { tab };
  }
  return directionId === undefined ? { tab, routeId } : { tab, routeId, directionId };
}

export function routeUrl(route: AppRoute): string {
  const mode = route.mode ?? 'bus';
  const params = new URLSearchParams();
  if (mode === 'parking') {
    params.set('mode', 'parking');
  } else if (route.mode === 'bus') {
    params.set('mode', 'bus');
  }
  params.set('tab', route.tab);
  if (mode === 'parking') {
    if (route.parkingId) {
      params.set('parking', route.parkingId);
    }
    if (route.query) {
      params.set('q', route.query);
    }
  } else {
    if (route.routeId) {
      params.set('route', route.routeId);
    }
    if (route.directionId !== undefined) {
      params.set('direction', String(route.directionId));
    }
  }
  return `${window.location.pathname}?${params.toString()}`;
}

export function navigateTo(route: AppRoute, replace = false): void {
  const url = routeUrl(route);
  if (replace) {
    window.history.replaceState(null, '', url);
  } else {
    window.history.pushState(null, '', url);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}
