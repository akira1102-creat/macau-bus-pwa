import { Bell, Check, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { ParkingFacility } from '../../../shared/parking-contract';
import type { LocalPreferences } from '../../infra/local-preferences';
import { PushClientError, type ParkingAlertSummary, type PushClient, type PushSupport } from '../../infra/push-client';

export interface ParkingAlertSheetProps {
  facility: ParkingFacility;
  preferences: LocalPreferences;
  pushClient: PushClient;
  onClose: () => void;
}

function supportCopy(support: PushSupport): string {
  if (support.reason === 'ios-not-standalone') {
    return 'iOS/iPadOS 請先將 PWA 加入主畫面，再開啟背景泊車提醒。';
  }
  if (support.permission === 'denied') {
    return '通知權限已拒絕，請在瀏覽器設定允許通知後再試。';
  }
  if (!support.supported) {
    return '此裝置不支援背景泊車提醒，請使用支援 Web Push 的瀏覽器。';
  }
  return '當私家車空位低於或等於門檻時通知一次，提醒會在 12 小時後自動失效。';
}

export function ParkingAlertSheet({ facility, preferences, pushClient, onClose }: ParkingAlertSheetProps) {
  const support = useMemo(() => pushClient.support(), [pushClient]);
  const [threshold, setThreshold] = useState(() => preferences.getParkingAlertThreshold());
  const [activeAlert, setActiveAlert] = useState<ParkingAlertSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!support.supported || !pushClient.listParkingAlerts) {
      setLoading(false);
      return undefined;
    }
    void pushClient.listParkingAlerts()
      .then((alerts) => {
        if (!active) return;
        setActiveAlert(alerts.find((alert) => alert.parkingId === facility.id) ?? null);
      })
      .catch(() => {
        if (active) setError('暫時無法讀取現有泊車提醒。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [facility.id, pushClient, support.supported]);

  const saveThreshold = (value: number) => {
    const next = preferences.setParkingAlertThreshold(value);
    setThreshold(next.parkingAlertThreshold);
  };

  const create = async () => {
    if (!pushClient.createParkingAlert) {
      setError('此版本暫時未能設定泊車提醒。');
      return;
    }
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const alert = await pushClient.createParkingAlert({ parkingId: facility.id, parkingName: facility.name, threshold });
      setActiveAlert(alert);
      setMessage('已設定低空位提醒。');
    } catch (cause) {
      setError(cause instanceof PushClientError && cause.code === 'permission-denied'
        ? '通知權限未允許，請在瀏覽器設定允許通知後再試。'
        : '暫時無法設定泊車提醒，請稍後再試。');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!activeAlert || !pushClient.deleteParkingAlert) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await pushClient.deleteParkingAlert(activeAlert.id);
      setActiveAlert(null);
      setMessage('已取消低空位提醒。');
    } catch {
      setError('暫時無法取消泊車提醒，請稍後再試。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="parking-alert-backdrop">
      <div className="parking-alert-sheet" role="dialog" aria-modal="true" aria-labelledby="parking-alert-title">
        <div className="parking-alert-sheet-heading">
          <div>
            <p className="eyebrow">泊車提醒</p>
            <h2 id="parking-alert-title">{facility.name}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="關閉" onClick={onClose}>
            <X aria-hidden="true" size={22} />
          </button>
        </div>
        <p className="parking-alert-support" role="status">{supportCopy(support)}</p>
        {loading ? <p className="muted-copy">讀取現有提醒中…</p> : null}
        {support.supported ? (
          <>
            <label className="parking-alert-threshold">
              <span>低空位提醒門檻</span>
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={threshold}
                aria-label="低空位提醒門檻"
                onChange={(event) => saveThreshold(Number(event.target.value))}
              />
              <small>私家車空位</small>
            </label>
            {activeAlert ? (
              <button type="button" className="parking-secondary-action" disabled={busy} onClick={() => void cancel()}>
                <Check aria-hidden="true" size={18} />{busy ? '取消中…' : '取消低空位提醒'}
              </button>
            ) : (
              <button type="button" className="parking-primary-action" disabled={busy} onClick={() => void create()}>
                <Bell aria-hidden="true" size={18} />{busy ? '設定中…' : '開啟低空位提醒'}
              </button>
            )}
          </>
        ) : null}
        {message ? <p className="parking-alert-success" role="status">{message}</p> : null}
        {error ? <p className="parking-alert-error" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}
