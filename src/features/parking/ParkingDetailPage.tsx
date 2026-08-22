import { ArrowLeft, BellPlus, Navigation, Star } from 'lucide-react';

import type { ParkingFacility } from '../../../shared/parking-contract';
import { messages } from '../../i18n/messages';
import { displayParkingSpace, openParkingNavigation } from './parking-utils';

export interface ParkingDetailPageProps {
  facility: ParkingFacility;
  favorite: boolean;
  onToggleFavorite: () => void;
  onRequestAlert?: (facility: ParkingFacility) => void;
  openNavigation?: (facility: ParkingFacility) => string;
  onBack: () => void;
}

function freshness(facility: ParkingFacility): string {
  if (facility.suspended) {
    return '目前暫停提供即時空位。';
  }
  if (!facility.updatedAt) {
    return '更新時間未知。';
  }
  const date = new Date(facility.updatedAt);
  return Number.isNaN(date.valueOf()) ? '更新時間未知。' : messages.parkingLastUpdated(date.toLocaleString('zh-Hant'));
}

export function ParkingDetailPage({
  facility,
  favorite,
  onToggleFavorite,
  onRequestAlert,
  openNavigation = openParkingNavigation,
  onBack,
}: ParkingDetailPageProps) {
  const spaces = [
    [messages.parkingSpaces, facility.spaces.car],
    [messages.parkingMotorcycle, facility.spaces.motorcycle],
    [messages.parkingElectricCar, facility.spaces.electricCar],
    [messages.parkingElectricMotorcycle, facility.spaces.electricMotorcycle],
    [messages.parkingAccessible, facility.spaces.accessible],
  ] as const;
  return (
    <div className="parking-detail-page">
      <div className="parking-detail-heading">
        <button type="button" className="back-button" onClick={onBack} aria-label={messages.back}><ArrowLeft aria-hidden="true" size={21} />{messages.back}</button>
        <button type="button" className={`parking-favorite-button${favorite ? ' is-favorite' : ''}`} aria-label={`${favorite ? '取消' : ''}${messages.parkingFavorite} ${facility.name}`} aria-pressed={favorite} onClick={onToggleFavorite}>
          <Star aria-hidden="true" fill={favorite ? 'currentColor' : 'none'} size={23} />
        </button>
      </div>
      <header className="parking-detail-title">
        <h1>{facility.name}</h1>
        <p>{facility.location ?? '位置未提供'}</p>
        <small>{freshness(facility)}</small>
      </header>
      <section className="parking-detail-space-list" aria-label="泊車空位詳情">
        {spaces.map(([label, value]) => (
          <div className="parking-detail-space" key={label}>
            <span>{label}</span>
            <strong>{displayParkingSpace(value, facility.suspended)}</strong>
          </div>
        ))}
      </section>
      <section className="parking-detail-copy" aria-label="停車場位置詳情">
        <h2>{messages.parkingAddress}</h2>
        <p>{facility.location ?? '—'}</p>
        <h2>{messages.parkingEntrance}</h2>
        <p>{facility.entrance ?? '—'}</p>
      </section>
      <div className="parking-detail-actions">
        <button type="button" className="parking-primary-action" onClick={() => openNavigation(facility)}><Navigation aria-hidden="true" size={19} />{messages.parkingNavigate}</button>
        <button type="button" className="parking-secondary-action" onClick={() => onRequestAlert?.(facility)}><BellPlus aria-hidden="true" size={19} />設定低空位提醒</button>
      </div>
      <p className="parking-source-note">{messages.parkingSourceNote}</p>
      <p className="parking-privacy-note">{messages.parkingPrivacyNote}</p>
    </div>
  );
}
