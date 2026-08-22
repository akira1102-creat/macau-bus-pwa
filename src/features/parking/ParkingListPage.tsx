import { LocateFixed, Search, Star } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ParkingFacility } from '../../../shared/parking-contract';
import { getCurrentPositionOnce, type CurrentPosition } from '../../infra/geolocation';
import type { LocalPreferences, Preferences } from '../../infra/local-preferences';
import { messages } from '../../i18n/messages';
import { StateMessage } from '../../components/StateMessage';
import {
  distanceMeters,
  displayParkingSpace,
  filterAndSortParkingFacilities,
  formatParkingDistance,
  type ParkingSort,
} from './parking-utils';

export interface ParkingListPageProps {
  facilities: readonly ParkingFacility[];
  updatedAt: string | null;
  stale?: boolean;
  error?: unknown;
  preferences: LocalPreferences;
  onOpenDetail: (parkingId: string) => void;
  getCurrentPosition?: () => Promise<CurrentPosition>;
  favoritesOnly?: boolean;
  title?: string;
  searchEnabled?: boolean;
  initialQuery?: string;
  query?: string;
  onQueryChange?: (query: string) => void;
}

function locationErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'permission-denied') {
    return messages.parkingLocationDenied;
  }
  if (code === 'unsupported') {
    return messages.parkingLocationUnsupported;
  }
  return messages.parkingLocationUnavailable;
}

function timeCopy(updatedAt: string | null): string {
  if (!updatedAt) {
    return '更新時間未知';
  }
  const date = new Date(updatedAt);
  return Number.isNaN(date.valueOf()) ? '更新時間未知' : messages.parkingLastUpdated(date.toLocaleString('zh-Hant', { hour: '2-digit', minute: '2-digit' }));
}

export function ParkingListPage({
  facilities,
  updatedAt,
  stale = false,
  error,
  preferences,
  onOpenDetail,
  getCurrentPosition = getCurrentPositionOnce,
  favoritesOnly = false,
  title = messages.parkingNearby,
  searchEnabled = true,
  initialQuery = '',
  query,
  onQueryChange,
}: ParkingListPageProps) {
  const [localQuery, setLocalQuery] = useState(initialQuery);
  const currentQuery = query ?? localQuery;
  const [sort, setSort] = useState<ParkingSort>('distance');
  const [position, setPosition] = useState<CurrentPosition | null>(null);
  const [locationState, setLocationState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [locationError, setLocationError] = useState('');
  const [preferenceState, setPreferenceState] = useState<Preferences>(() => preferences.get());

  const candidates = useMemo(
    () => favoritesOnly
      ? facilities.filter((facility) => preferenceState.parkingFavorites.includes(facility.id))
      : facilities,
    [facilities, favoritesOnly, preferenceState.parkingFavorites],
  );
  const visibleFacilities = useMemo(
    () => filterAndSortParkingFacilities(candidates, { query: currentQuery, sort, position }),
    [candidates, currentQuery, position, sort],
  );

  const requestLocation = async () => {
    setLocationState('loading');
    setLocationError('');
    try {
      const nextPosition = await getCurrentPosition();
      setPosition(nextPosition);
      setSort('distance');
      setLocationState('ready');
    } catch (nextError) {
      setPosition(null);
      setLocationError(locationErrorMessage(nextError));
      setLocationState('error');
    }
  };

  const toggleFavorite = (parkingId: string) => {
    setPreferenceState(preferences.toggleParkingFavorite(parkingId));
  };

  const handleQueryChange = (nextQuery: string) => {
    if (query === undefined) {
      setLocalQuery(nextQuery);
    }
    onQueryChange?.(nextQuery);
  };

  return (
    <div className="parking-page parking-list-page">
      <header className="page-heading">
        <h1>{title}</h1>
        <p>{messages.parkingSourceNote}</p>
      </header>
      {searchEnabled ? (
        <label className="search-field directory-search parking-search-field">
          <Search aria-hidden="true" size={23} strokeWidth={1.8} />
          <span className="sr-only">{messages.parkingSearchPlaceholder}</span>
          <input
            type="search"
            aria-label={messages.parkingSearchPlaceholder}
            placeholder={messages.parkingSearchPlaceholder}
            value={currentQuery}
            onChange={(event) => handleQueryChange(event.target.value)}
          />
        </label>
      ) : null}
      <section className="parking-controls" aria-label="泊車列表控制">
        <button className="location-button" type="button" onClick={() => void requestLocation()} disabled={locationState === 'loading'}>
          <LocateFixed aria-hidden="true" size={22} strokeWidth={1.8} />
          <span>{messages.parkingUseLocation}</span>
        </button>
        <div className="parking-sort-tabs" role="group" aria-label="泊車排序">
          {([
            ['distance', messages.parkingSortNearby],
            ['spaces', messages.parkingSortSpaces],
            ['name', messages.parkingSortName],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={sort === value} className={sort === value ? 'is-selected' : ''} onClick={() => setSort(value)}>{label}</button>
          ))}
        </div>
      </section>
      {stale ? <p className="parking-stale-message" role="status">{messages.parkingStale}</p> : null}
      {error ? <p className="parking-error-message" role="alert">{messages.parkingUnavailable}</p> : null}
      {locationState === 'loading' ? <StateMessage kind="loading">{messages.parkingLoading}</StateMessage> : null}
      {locationError ? <StateMessage kind="error">{locationError}</StateMessage> : null}
      {locationState === 'idle' ? <p className="muted-copy parking-location-note">{messages.parkingNoLocation}</p> : null}
      <section className="parking-list" aria-label={title}>
        {visibleFacilities.length > 0 ? visibleFacilities.map((facility) => {
          const favorite = preferenceState.parkingFavorites.includes(facility.id);
          const distance = position ? distanceMeters(position, facility) : null;
          return (
            <article className="parking-row" key={facility.id}>
              <button type="button" className="parking-row-main" aria-label={`開啟停車場 ${facility.name}`} onClick={() => onOpenDetail(facility.id)}>
                <span className="parking-row-copy">
                  <strong>{facility.name}</strong>
                  <span>{facility.location ?? '位置未提供'}</span>
                  <small>{timeCopy(facility.updatedAt ?? updatedAt)}</small>
                </span>
                <span className="parking-row-spaces"><b>{displayParkingSpace(facility.spaces.car, facility.suspended)}</b><small>{messages.parkingSpaces}</small></span>
                <span className="parking-row-meta">
                  <span>{formatParkingDistance(distance)}</span>
                  <span>{messages.parkingMotorcycle} {displayParkingSpace(facility.spaces.motorcycle, facility.suspended)}</span>
                  <span>{messages.parkingElectricCar} {displayParkingSpace(facility.spaces.electricCar, facility.suspended)}</span>
                  <span>{messages.parkingElectricMotorcycle} {displayParkingSpace(facility.spaces.electricMotorcycle, facility.suspended)}</span>
                  <span>{messages.parkingAccessible} {displayParkingSpace(facility.spaces.accessible, facility.suspended)}</span>
                </span>
              </button>
              <button
                type="button"
                className={`parking-favorite-button${favorite ? ' is-favorite' : ''}`}
                aria-label={`${favorite ? '取消' : ''}收藏停車場 ${facility.name}`}
                aria-pressed={favorite}
                onClick={() => toggleFavorite(facility.id)}
              >
                <Star aria-hidden="true" fill={favorite ? 'currentColor' : 'none'} size={22} strokeWidth={1.8} />
              </button>
            </article>
          );
        }) : <p className="empty-copy">{messages.parkingNoResults}</p>}
      </section>
    </div>
  );
}
