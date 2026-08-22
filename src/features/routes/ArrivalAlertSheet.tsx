import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { DirectionId, RouteDirection, RouteSummary, BusStop } from '../../../shared/transit-contract';
import { PushClientError, type ArrivalAlertSummary, type PushClient } from '../../infra/push-client';

export interface ArrivalAlertSheetProps {
  route: RouteSummary;
  direction: RouteDirection;
  stop: BusStop;
  targetStopIndex: number;
  leadStops: number;
  pushClient: PushClient;
  onClose: () => void;
}

function matchesStop(alert: ArrivalAlertSummary, routeId: string, direction: DirectionId, stopId: string, targetStopIndex: number): boolean {
  return alert.routeId === routeId
    && alert.direction === direction
    && alert.targetStopId === stopId
    && alert.targetStopIndex === targetStopIndex;
}

function errorCopy(error: unknown): string {
  if (error instanceof PushClientError && error.code === 'unsupported') {
    return '此裝置未支援背景到站提醒，請使用支援 Web Push 的瀏覽器並將 PWA 加到主畫面。';
  }
  if (error instanceof PushClientError && error.code === 'permission-denied') {
    return '通知權限未開啟；請在瀏覽器設定允許通知後再試。';
  }
  return '暫時無法設定到站提醒，請稍後再試。';
}

export function ArrivalAlertSheet({ route, direction, stop, targetStopIndex, leadStops, pushClient, onClose }: ArrivalAlertSheetProps) {
  const support = useMemo(() => pushClient.support(), [pushClient]);
  const [activeAlert, setActiveAlert] = useState<ArrivalAlertSummary | null>(null);
  const [status, setStatus] = useState<'loading' | 'idle' | 'creating' | 'cancelling' | 'created' | 'cancelled'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!support.supported || !pushClient.prepare) {
      return;
    }
    void pushClient.prepare().catch(() => undefined);
  }, [pushClient, support.supported]);

  useEffect(() => {
    let active = true;
    void pushClient.listAlerts()
      .then((alerts) => {
        if (!active) {
          return;
        }
        setActiveAlert(alerts.find((alert) => matchesStop(alert, route.id, direction.id, stop.id, targetStopIndex)) ?? null);
        setStatus('idle');
      })
      .catch((reason: unknown) => {
        if (!active) {
          return;
        }
        setError(errorCopy(reason));
        setStatus('idle');
      });
    return () => {
      active = false;
    };
  }, [direction.id, pushClient, route.id, stop.id, targetStopIndex]);

  const createReminder = async () => {
    setError('');
    setStatus('creating');
    try {
      const created = await pushClient.createAlert({
        routeId: route.id,
        direction: direction.id,
        targetStopId: stop.id,
        targetStopIndex,
        threshold: leadStops,
      });
      setActiveAlert(created);
      setStatus('created');
    } catch (reason: unknown) {
      setError(errorCopy(reason));
      setStatus('idle');
    }
  };

  const cancelReminder = async () => {
    if (!activeAlert) {
      return;
    }
    setError('');
    setStatus('cancelling');
    try {
      await pushClient.deleteAlert(activeAlert.id);
      setActiveAlert(null);
      setStatus('cancelled');
    } catch (reason: unknown) {
      setError(errorCopy(reason));
      setStatus('idle');
    }
  };

  const unsupportedCopy = support.supported
    ? support.permission === 'denied'
      ? '通知權限已關閉；請在瀏覽器設定允許通知後再設定提醒。'
      : ''
    : support.reason === 'ios-not-standalone'
      ? 'iOS/iPadOS 需先將 PWA 加入主畫面，然後從主畫面開啟提醒功能。'
      : '此裝置未支援背景到站提醒，請使用支援 Web Push 的瀏覽器並將 PWA 加到主畫面。';

  return (
    <div className="arrival-alert-backdrop" role="presentation">
      <section className="arrival-alert-sheet" role="dialog" aria-modal="true" aria-labelledby="arrival-alert-title">
        <header className="arrival-alert-heading">
          <div>
            <p className="arrival-alert-kicker">{route.id} · {direction.name}</p>
            <h2 id="arrival-alert-title">設定到站提醒</h2>
            <p>{stop.id} · {stop.nameCn}</p>
          </div>
          <button type="button" className="icon-button" aria-label="關閉提醒設定" onClick={onClose}>
            <X aria-hidden="true" size={24} />
          </button>
        </header>
        <p className="arrival-alert-lead"><strong>提前 {activeAlert?.threshold ?? leadStops} 站</strong>通知你。</p>
        {unsupportedCopy ? <p className="arrival-alert-message" role="status">{unsupportedCopy}</p> : null}
        {error ? <p className="arrival-alert-message arrival-alert-error" role="alert">{error}</p> : null}
        {activeAlert ? (
          <div className="arrival-alert-active">
            <p>現有提醒：提前 {activeAlert.threshold} 站</p>
            <button type="button" className="text-button" disabled={status === 'cancelling'} onClick={() => void cancelReminder()}>
              {status === 'cancelling' ? '取消中…' : '取消提醒'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="arrival-alert-primary"
            disabled={!support.supported || status === 'creating'}
            onClick={() => void createReminder()}
          >
            {status === 'creating' ? '設定中…' : '設定一次性提醒'}
          </button>
        )}
        {status === 'created' ? <p className="arrival-alert-success" role="status">提醒已設定：提前 {activeAlert?.threshold ?? leadStops} 站</p> : null}
        {status === 'cancelled' ? <p className="arrival-alert-success" role="status">提醒已取消</p> : null}
      </section>
    </div>
  );
}
