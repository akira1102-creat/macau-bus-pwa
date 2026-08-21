import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { LocalPreferences, Preferences } from '../../infra/local-preferences';
import type { RouteSummary, TransitCatalog } from '../../../shared/transit-contract';
import { messages } from '../../i18n/messages';
import { RouteListItem } from '../../components/RouteListItem';

interface RouteDirectoryPageProps {
  catalog: TransitCatalog;
  preferences: LocalPreferences;
  onOpenRoute: (routeId: string) => void;
  onlyFavorites?: boolean;
  title?: string;
  emptyCopy?: string;
}

export function RouteDirectoryPage({ catalog, preferences, onOpenRoute, onlyFavorites = false, title = messages.routeDirectory, emptyCopy = messages.noFavorites }: RouteDirectoryPageProps) {
  const [query, setQuery] = useState('');
  const [preferenceState, setPreferenceState] = useState<Preferences>(() => preferences.get());
  const routes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return catalog.routes.filter((route) => {
      if (onlyFavorites && !preferenceState.favorites.includes(route.id)) {
        return false;
      }
      return !normalized || [route.id, route.name, route.displayName, route.operator]
        .some((value) => value.toLocaleLowerCase().includes(normalized));
    });
  }, [catalog.routes, onlyFavorites, preferenceState.favorites, query]);
  const openRoute = (route: RouteSummary) => {
    setPreferenceState(preferences.addRecent(route.id));
    onOpenRoute(route.id);
  };
  return (
    <div className="directory-page">
      <header className="page-heading"><h1>{title}</h1><p>使用本機同步的路線資料。</p></header>
      {onlyFavorites || title === messages.routeMap ? null : (
        <label className="search-field directory-search">
          <Search aria-hidden="true" size={23} strokeWidth={1.8} />
          <span className="sr-only">搜尋路線</span>
          <input type="search" aria-label="搜尋路線" placeholder="搜尋路線" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      )}
      <section className="content-section route-directory-list" aria-label={title}>
        {routes.length > 0 ? routes.map((route) => (
          <RouteListItem
            key={route.id}
            route={route}
            favorite={preferenceState.favorites.includes(route.id)}
            onOpen={() => openRoute(route)}
            onToggleFavorite={() => setPreferenceState(preferences.toggleFavorite(route.id))}
          />
        )) : <p className="empty-copy">{emptyCopy}</p>}
      </section>
    </div>
  );
}
