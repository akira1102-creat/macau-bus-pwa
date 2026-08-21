export type AppTab = 'nearby' | 'routes' | 'map' | 'favorites' | 'settings';

export interface AppRoute {
  tab: AppTab;
  routeId?: string;
}

function isTab(value: string | null): value is AppTab {
  return value === 'nearby'
    || value === 'routes'
    || value === 'map'
    || value === 'favorites'
    || value === 'settings';
}

export function parseRoute(location: Location = window.location): AppRoute {
  const params = new URLSearchParams(location.search);
  const tabValue = params.get('tab');
  const tab = isTab(tabValue) ? tabValue : 'nearby';
  const routeId = params.get('route')?.trim() || undefined;
  return routeId ? { tab, routeId } : { tab };
}

export function routeUrl(route: AppRoute): string {
  const params = new URLSearchParams({ tab: route.tab });
  if (route.routeId) {
    params.set('route', route.routeId);
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
