import { BusFront, ChevronRight, Star } from 'lucide-react';

import type { RouteSummary } from '../../shared/transit-contract';
import { messages } from '../i18n/messages';

interface RouteListItemProps {
  route: RouteSummary;
  favorite: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
  compact?: boolean;
}

export function RouteListItem({ route, favorite, onOpen, onToggleFavorite, compact = false }: RouteListItemProps) {
  return (
    <div className={`route-list-item${compact ? ' is-compact' : ''}`}>
      <button className="route-list-main" type="button" aria-label={`${messages.openRoute(route.id)} ${route.displayName}`} onClick={onOpen}>
        <BusFront aria-hidden="true" size={compact ? 31 : 38} strokeWidth={1.8} />
        <span className="route-list-copy">
          <strong>{route.id}</strong>
          <span>{route.displayName}</span>
        </span>
        <ChevronRight aria-hidden="true" size={25} strokeWidth={1.8} />
      </button>
      <button
        className={`route-favorite-button${favorite ? ' is-favorite' : ''}`}
        type="button"
        aria-label={messages.favoriteRoute(route.id)}
        aria-pressed={favorite}
        onClick={onToggleFavorite}
      >
        <Star aria-hidden="true" size={22} fill={favorite ? 'currentColor' : 'none'} strokeWidth={1.8} />
      </button>
    </div>
  );
}
