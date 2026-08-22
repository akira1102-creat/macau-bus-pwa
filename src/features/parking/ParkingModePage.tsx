import { useMemo, useState } from 'react';

import type { ParkingFacility } from '../../../shared/parking-contract';
import type { AppTab } from '../../app/router';
import type { LocalPreferences } from '../../infra/local-preferences';
import type { ParkingApiClient } from '../../infra/parking-client';
import { getCurrentPositionOnce, type CurrentPosition } from '../../infra/geolocation';
import { messages } from '../../i18n/messages';
import { StateMessage } from '../../components/StateMessage';
import { ParkingDetailPage } from './ParkingDetailPage';
import { ParkingListPage } from './ParkingListPage';
import { ParkingMapPage } from './ParkingMapPage';
import { useParkingPolling } from './useParkingPolling';

export interface ParkingModePageProps {
  tab: AppTab;
  parkingId?: string;
  query?: string;
  client: ParkingApiClient;
  preferences: LocalPreferences;
  getCurrentPosition?: () => Promise<CurrentPosition>;
  onOpenDetail: (parkingId: string) => void;
  onBack: () => void;
  onRequestAlert?: (facility: ParkingFacility) => void;
}

function facilityForId(facilities: readonly ParkingFacility[], parkingId: string | undefined): ParkingFacility | undefined {
  return parkingId === undefined ? undefined : facilities.find((facility) => facility.id === parkingId);
}

export function ParkingModePage({
  tab,
  parkingId,
  query,
  client,
  preferences,
  getCurrentPosition = getCurrentPositionOnce,
  onOpenDetail,
  onBack,
  onRequestAlert,
}: ParkingModePageProps) {
  const polling = useParkingPolling(client);
  const snapshot = polling.data;
  const facilities = snapshot?.facilities ?? [];
  const detail = useMemo(() => facilityForId(facilities, parkingId), [facilities, parkingId]);
  const [parkingFavorites, setParkingFavorites] = useState(() => new Set(preferences.getParkingFavorites()));

  if (parkingId !== undefined) {
    if (!snapshot && polling.status === 'loading') {
      return <StateMessage kind="loading">{messages.parkingLoading}</StateMessage>;
    }
    if (!detail) {
      return (
        <div className="parking-not-found">
          <StateMessage kind="empty">{messages.parkingNoResults}</StateMessage>
          <button type="button" className="back-button" onClick={onBack}>{messages.back}</button>
        </div>
      );
    }
    return (
      <ParkingDetailPage
        facility={detail}
        favorite={parkingFavorites.has(detail.id)}
        onToggleFavorite={() => {
          const next = preferences.toggleParkingFavorite(detail.id);
          setParkingFavorites(new Set(next.parkingFavorites));
        }}
        {...(onRequestAlert === undefined ? {} : { onRequestAlert })}
        onBack={onBack}
      />
    );
  }

  if (!snapshot && polling.status === 'loading') {
    return <StateMessage kind="loading">{messages.parkingLoading}</StateMessage>;
  }
  if (!snapshot && polling.status === 'error') {
    return <StateMessage kind="error" actionLabel={messages.refresh} onAction={polling.refresh}>{messages.parkingUnavailable}</StateMessage>;
  }

  const listProps = {
    facilities,
    updatedAt: snapshot?.updatedAt ?? null,
    stale: snapshot?.stale || polling.status === 'error',
    error: polling.status === 'error' ? polling.error : undefined,
    preferences,
    onOpenDetail,
    getCurrentPosition,
  };
  if (tab === 'map') {
    return <ParkingMapPage facilities={facilities} selectedId={null} onSelectFacility={onOpenDetail} />;
  }
  if (tab === 'search') {
    return <ParkingListPage {...listProps} title={messages.parkingSearch} {...(query === undefined ? {} : { initialQuery: query })} />;
  }
  if (tab === 'favorites') {
    return <ParkingListPage {...listProps} title={messages.parkingFavorites} favoritesOnly />;
  }
  return <ParkingListPage {...listProps} title={messages.parkingNearby} />;
}

export const ParkingPage = ParkingModePage;
