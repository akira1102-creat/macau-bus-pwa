import { BusFront, ChevronRight } from 'lucide-react';

import type { BusStop, RouteSummary } from '../../shared/transit-contract';

interface StopListItemProps {
  stop: BusStop;
  distanceMeters?: number;
  onOpen?: (() => void) | undefined;
  routeOptions?: RouteSummary[];
  onOpenRoute?: (routeId: string) => void;
}

export function StopListItem({ stop, distanceMeters, onOpen, routeOptions = [], onOpenRoute }: StopListItemProps) {
  const stopContent = (
    <>
      <span className="stop-icon" aria-hidden="true"><BusFront size={25} strokeWidth={1.8} /></span>
      <span className="stop-list-copy">
        <strong>{stop.id}</strong>
        <span>{stop.nameCn}</span>
      </span>
      {distanceMeters === undefined ? null : <span className="distance-label">{Math.round(distanceMeters)} 米</span>}
    </>
  );

  return (
    <div className="stop-list-item">
      {onOpen ? (
        <button className="stop-list-main" type="button" onClick={onOpen}>
          {stopContent}
          <ChevronRight aria-hidden="true" size={24} strokeWidth={1.8} />
        </button>
      ) : <div className="stop-list-main is-static">{stopContent}</div>}
      {routeOptions.length > 0 ? (
        <div className="stop-route-options" aria-label={`${stop.nameCn} 可選路線`}>
          {routeOptions.map((route) => (
            <button
              className="stop-route-option"
              type="button"
              key={route.id}
              aria-label={`開啟路線 ${route.id} ${route.displayName}`}
              onClick={() => onOpenRoute?.(route.id)}
            >
              {route.id}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
