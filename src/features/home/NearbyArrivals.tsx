import { useEffect, useMemo, useState } from 'react';

import type { CatalogRepository } from '../../data/catalog-repository';
import { type NearbyStop } from '../../domain/nearby';
import type { ArrivalResult, ArrivalsClient } from '../../infra/arrivals-client';
import type { DirectionId } from '../../../shared/transit-contract';
import { StateMessage } from '../../components/StateMessage';
import { StopListItem } from '../../components/StopListItem';

export interface NearbyArrivalsProps {
  nearbyStops: readonly NearbyStop[];
  repository: CatalogRepository;
  arrivalsClient: ArrivalsClient;
  onOpenRoute: (routeId: string, directionId?: DirectionId) => void;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

const STOP_ID_SEPARATOR = '\u001f';

function directionName(repository: CatalogRepository, arrival: ArrivalResult): string {
  return repository.getRoute(arrival.route)?.directions.find((direction) => direction.id === arrival.direction)?.name
    ?? `方向 ${arrival.direction}`;
}

function arrivalsForStop(arrivals: readonly ArrivalResult[], stopId: string): ArrivalResult[] {
  return arrivals.filter((arrival) => arrival.stopId === stopId);
}

export function NearbyArrivals({ nearbyStops, repository, arrivalsClient, onOpenRoute }: NearbyArrivalsProps) {
  const visibleStops = nearbyStops.slice(0, 5);
  const stopIdsKey = useMemo(
    () => visibleStops.map(({ stop }) => stop.id).join(STOP_ID_SEPARATOR),
    [visibleStops],
  );
  const [arrivals, setArrivals] = useState<ArrivalResult[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');

  useEffect(() => {
    const stopIds = stopIdsKey ? stopIdsKey.split(STOP_ID_SEPARATOR) : [];
    const controller = new AbortController();
    let active = true;

    if (stopIds.length === 0) {
      setArrivals([]);
      setLoadState('idle');
      return () => {
        active = false;
        controller.abort();
      };
    }

    setArrivals([]);
    setLoadState('loading');
    void arrivalsClient.getForStops(stopIds, controller.signal)
      .then((response) => {
        if (!active) {
          return;
        }
        setArrivals(response.arrivals);
        setLoadState('ready');
      })
      .catch(() => {
        if (!active || controller.signal.aborted) {
          return;
        }
        setArrivals([]);
        setLoadState('error');
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [arrivalsClient, stopIdsKey]);

  return (
    <div className="nearby-arrivals" aria-label="附近站點及到站資料">
      {loadState === 'loading' ? <StateMessage kind="loading">正在取得附近實時到站資料…</StateMessage> : null}
      {loadState === 'error' ? <StateMessage kind="error">暫時無法取得附近實時到站資料，仍可使用附近站點。</StateMessage> : null}
      {visibleStops.map(({ stop, distanceMeters }) => {
        const stopArrivals = arrivalsForStop(arrivals, stop.id);
        const routeOptions = stop.routeIds.flatMap((routeId) => {
          const route = repository.getRoute(routeId);
          return route ? [route] : [];
        });
        return (
          <div className="nearby-arrival-stop" key={stop.id}>
            <StopListItem
              stop={stop}
              distanceMeters={distanceMeters}
              routeOptions={routeOptions}
              onOpenRoute={(routeId) => onOpenRoute(routeId)}
            />
            {loadState !== 'error' && stopArrivals.length === 0 && loadState === 'ready' ? (
              <p className="nearby-arrivals-empty muted-copy">暫時沒有即將到站巴士。</p>
            ) : null}
            {stopArrivals.length > 0 ? (
              <ul className="nearby-arrival-list" aria-label={`${stop.nameCn} 到站資料`}>
                {stopArrivals.map((arrival, index) => {
                  const name = directionName(repository, arrival);
                  const plate = arrival.plate.trim() || '未提供車牌';
                  const remaining = arrival.remainingStops === 0 ? '已到站' : `仲有 ${arrival.remainingStops} 站`;
                  return (
                    <li className="nearby-arrival-row" key={`${arrival.route}-${arrival.direction}-${arrival.plate}-${index}`}>
                      <button
                        className="nearby-arrival-button"
                        type="button"
                        aria-label={`開啟路線 ${arrival.route} ${name} ${plate}`}
                        onClick={() => onOpenRoute(arrival.route, arrival.direction)}
                      >
                        <span className="nearby-arrival-route">{arrival.route}</span>
                        <span className="nearby-arrival-direction">{name}</span>
                        <span className="nearby-arrival-plate">{plate}</span>
                        <span className="nearby-arrival-remaining">{remaining}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
