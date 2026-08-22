import { Moon, Monitor, Sun } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { LocalPreferences, Theme } from '../../infra/local-preferences';
import { createPushClient, type ArrivalAlertSummary, type PushClient, type PushSupport } from '../../infra/push-client';
import { messages } from '../../i18n/messages';

export interface SettingsPageProps {
  preferences: LocalPreferences;
  onThemeChange: (theme: Theme) => void;
  pushClient?: PushClient;
}

const themeOptions: Array<{ value: Theme; label: string; icon: typeof Monitor }> = [
  { value: 'system', label: messages.system, icon: Monitor },
  { value: 'light', label: messages.light, icon: Sun },
  { value: 'dark', label: messages.dark, icon: Moon },
];

const leadStopOptions = Array.from({ length: 10 }, (_, index) => index + 1);

function pushStatusCopy(support: PushSupport): string {
  if (support.reason === 'ios-not-standalone') {
    return 'iOS/iPadOS 需先將 PWA 加入主畫面，然後從主畫面開啟提醒功能。';
  }
  if (!support.supported) {
    return '此裝置未支援背景到站提醒，請使用支援 Web Push 的瀏覽器並將 PWA 加到主畫面。';
  }
  if (support.permission === 'granted') {
    return '通知權限已允許';
  }
  if (support.permission === 'denied') {
    return '通知權限已拒絕；請在瀏覽器設定允許通知。';
  }
  return '尚未允許通知；設定提醒時瀏覽器會詢問權限。';
}

export function SettingsPage({ preferences, onThemeChange, pushClient }: SettingsPageProps) {
  const [activeTheme, setActiveTheme] = useState<Theme>(() => preferences.getTheme());
  const [leadStops, setLeadStops] = useState(() => preferences.getNotificationLeadStops());
  const [activeAlerts, setActiveAlerts] = useState<ArrivalAlertSummary[]>([]);
  const [alertError, setAlertError] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const client = useMemo(() => pushClient ?? createPushClient(), [pushClient]);
  const support = useMemo(() => client.support(), [client]);

  useEffect(() => {
    if (!support.supported) {
      return undefined;
    }
    let active = true;
    void client.listAlerts()
      .then((alerts) => {
        if (active) {
          setActiveAlerts(alerts);
        }
      })
      .catch(() => {
        if (active) {
          setAlertError('暫時無法載入現有到站提醒。');
        }
      });
    return () => {
      active = false;
    };
  }, [client, support.supported]);

  const handleThemeChange = (theme: Theme) => {
    preferences.setTheme(theme);
    setActiveTheme(theme);
    onThemeChange(theme);
  };

  const handleLeadStopsChange = (value: number) => {
    const next = preferences.setNotificationLeadStops(value);
    setLeadStops(next.notificationLeadStops);
  };

  const cancelAlert = async (alert: ArrivalAlertSummary) => {
    setCancellingId(alert.id);
    setAlertError('');
    try {
      await client.deleteAlert(alert.id);
      setActiveAlerts((current) => current.filter((candidate) => candidate.id !== alert.id));
    } catch {
      setAlertError('暫時無法取消到站提醒，請稍後再試。');
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="settings-page">
      <header className="page-heading"><h1>{messages.settings}</h1><p>調整此裝置上的顯示方式。</p></header>
      <section className="settings-section" aria-labelledby="theme-title">
        <h2 id="theme-title">{messages.theme}</h2>
        <div className="theme-options" role="radiogroup" aria-label={messages.theme}>
          {themeOptions.map(({ value, label, icon: Icon }) => (
            <label className={`theme-option${activeTheme === value ? ' is-selected' : ''}`} key={value}>
              <Icon aria-hidden="true" size={24} strokeWidth={1.8} />
              <span>{label}</span>
              <input
                type="radio"
                name="theme"
                value={value}
                checked={activeTheme === value}
                onChange={() => handleThemeChange(value)}
                aria-label={label}
              />
            </label>
          ))}
        </div>
      </section>
      <section className="settings-section" aria-labelledby="arrival-alert-settings-title">
        <h2 id="arrival-alert-settings-title">到站提醒</h2>
        <p className="settings-support-status" role="status">{pushStatusCopy(support)}</p>
        <fieldset className="lead-stop-options">
          <legend>預設提前站數</legend>
          <div className="lead-stop-grid" role="radiogroup" aria-label="預設提前站數">
            {leadStopOptions.map((value) => (
              <label className={`lead-stop-option${leadStops === value ? ' is-selected' : ''}`} key={value}>
                <input
                  type="radio"
                  name="notificationLeadStops"
                  value={value}
                  checked={leadStops === value}
                  aria-label={`提前 ${value} 站`}
                  onChange={() => handleLeadStopsChange(value)}
                />
                <span>提前 {value} 站</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="settings-alerts" aria-labelledby="active-alerts-title">
          <h3 id="active-alerts-title">現有一次性提醒</h3>
          {activeAlerts.length > 0 ? activeAlerts.map((alert) => (
            <div className="settings-alert-row" key={alert.id}>
              <span>路線 {alert.routeId} · 方向 {alert.direction} · 第 {alert.targetStopIndex + 1} 站 · {alert.targetStopId} · 提前 {alert.threshold} 站</span>
              <button type="button" className="text-button" disabled={cancellingId === alert.id} onClick={() => void cancelAlert(alert)}>
                {cancellingId === alert.id ? '取消中…' : '取消提醒'}
              </button>
            </div>
          )) : <p className="muted-copy">目前沒有現有提醒。</p>}
          {alertError ? <p className="settings-alert-error" role="alert">{alertError}</p> : null}
        </div>
      </section>
      <section className="settings-section settings-note" aria-labelledby="privacy-title">
        <h2 id="privacy-title">本機資料</h2>
        <p>收藏、最近查看及顯示設定只儲存在此瀏覽器。定位只在本機計算，不會傳送至伺服器。</p>
      </section>
    </div>
  );
}
