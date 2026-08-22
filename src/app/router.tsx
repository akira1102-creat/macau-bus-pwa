import type { DirectionId } from '../../shared/transit-contract';

export type AppTab = 'nearby' | 'routes' | 'map' | 'favorites' | 'settings';

export interface AppRoute {
  tab: AppTab;
  routeId?: string;
  directionId?: DirectionId;
}

function isTab(value: string | null): value is AppTab {
  return value === 'nearby'
    || value === 'routes'
    || value === 'map'
    || value === 'favorites'
    || value === 'settings';
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

export function parseRoute(location: Location = window.location): AppRoute {
  const params = new URLSearchParams(location.search);
  const tabValue = params.get('tab');
  const tab = isTab(tabValue) ? tabValue : 'nearby';
  const routeId = params.get('route')?.trim() || undefined;
  const directionId = parseDirectionId(params.get('direction'));
  if (!routeId) {
    return { tab };
  }
  return directionId === undefined ? { tab, routeId } : { tab, routeId, directionId };
}

export function routeUrl(route: AppRoute): string {
  const params = new URLSearchParams({ tab: route.tab });
  if (route.routeId) {
    params.set('route', route.routeId);
  }
  if (route.directionId !== undefined) {
    params.set('direction', String(route.directionId));
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
