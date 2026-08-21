import { BusFront, ChevronRight } from 'lucide-react';

import type { BusStop } from '../../shared/transit-contract';

interface StopListItemProps {
  stop: BusStop;
  distanceMeters?: number;
  onOpen?: (() => void) | undefined;
}

export function StopListItem({ stop, distanceMeters, onOpen }: StopListItemProps) {
  return (
    <button className="stop-list-item" type="button" onClick={onOpen}>
      <span className="stop-icon" aria-hidden="true"><BusFront size={25} strokeWidth={1.8} /></span>
      <span className="stop-list-copy">
        <strong>{stop.id}</strong>
        <span>{stop.nameCn}</span>
      </span>
      {distanceMeters === undefined ? null : <span className="distance-label">{Math.round(distanceMeters)} 米</span>}
      {onOpen ? <ChevronRight aria-hidden="true" size={24} strokeWidth={1.8} /> : null}
    </button>
  );
}
