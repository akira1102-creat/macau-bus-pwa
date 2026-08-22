import type { ReactNode } from 'react';
import { Bell, BusFront, Map, MapPin, Search, Settings, Star } from 'lucide-react';

import { getNavigationTabs, type AppTab } from '../app/router';
import type { AppMode } from '../infra/local-preferences';
import { messages } from '../i18n/messages';

interface AppShellProps {
  activeMode?: AppMode;
  activeModePreference?: AppMode | null;
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onModeChange?: (mode: AppMode) => void;
  children: ReactNode;
  title?: string;
  showHeader?: boolean;
}

const tabDetails: Record<string, { label: string; icon: typeof MapPin }> = {
  nearby: { label: messages.nearby, icon: MapPin },
  routes: { label: messages.routes, icon: BusFront },
  map: { label: messages.map, icon: Map },
  search: { label: messages.search, icon: Search },
  favorites: { label: messages.favorites, icon: Star },
  settings: { label: messages.settings, icon: Settings },
};

export function AppShell({
  activeMode = 'bus',
  activeModePreference = activeMode,
  activeTab,
  onTabChange,
  onModeChange,
  children,
  title = messages.appName,
  showHeader = true,
}: AppShellProps) {
  const tabs = getNavigationTabs(activeMode);
  const selectedTab = activeTab === 'detail' ? 'nearby' : activeTab;
  const changeMode = (mode: AppMode) => onModeChange?.(mode);
  return (
    <div className="app-shell">
      {showHeader ? (
        <header className="app-header">
          <h1>{title}</h1>
          <div className="app-mode-switch" role="group" aria-label="快速切換模式">
            <button
              type="button"
              className={activeMode === 'bus' ? 'is-selected' : ''}
              aria-label="切換至巴士模式"
              aria-pressed={activeMode === 'bus'}
              onClick={() => changeMode('bus')}
            >
              巴士
            </button>
            <button
              type="button"
              className={activeMode === 'parking' ? 'is-selected' : ''}
              aria-label="切換至泊車模式"
              aria-pressed={activeMode === 'parking'}
              onClick={() => changeMode('parking')}
            >
              泊車
            </button>
          </div>
          <span className="icon-button" aria-hidden="true" title="通知">
            <Bell aria-hidden="true" size={25} strokeWidth={1.8} />
          </span>
        </header>
      ) : null}
      {!showHeader ? (
        <div className="app-mode-switch app-mode-switch-detail" role="group" aria-label="快速切換模式">
          <button type="button" className={activeMode === 'bus' ? 'is-selected' : ''} aria-label="切換至巴士模式" aria-pressed={activeMode === 'bus'} onClick={() => changeMode('bus')}>巴士</button>
          <button type="button" className={activeMode === 'parking' ? 'is-selected' : ''} aria-label="切換至泊車模式" aria-pressed={activeMode === 'parking'} onClick={() => changeMode('parking')}>泊車</button>
        </div>
      ) : null}
      <main className="app-content">{children}</main>
      <nav className="bottom-nav" aria-label="主要導覽">
        {tabs.map((id) => {
          const detail = tabDetails[id];
          if (!detail) {
            return null;
          }
          const { label, icon: Icon } = detail;
          return (
            <button
              className={`bottom-nav-item${selectedTab === id ? ' is-active' : ''}`}
              type="button"
              key={id}
              aria-current={selectedTab === id ? 'page' : undefined}
              onClick={() => onTabChange(id)}
            >
              <Icon aria-hidden="true" size={27} strokeWidth={selectedTab === id ? 2.2 : 1.7} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
      {activeModePreference === null && onModeChange ? (
        <div className="mode-choice-backdrop" role="presentation">
          <section className="mode-choice-sheet" role="dialog" aria-modal="true" aria-labelledby="mode-choice-title">
            <p className="mode-choice-kicker">澳門實時巴士</p>
            <h2 id="mode-choice-title">選擇使用模式</h2>
            <p>你可以隨時在頂部快速切換，收藏和設定會分開保存。</p>
            <div className="mode-choice-actions">
              <button type="button" onClick={() => changeMode('bus')}>搭巴士</button>
              <button type="button" onClick={() => changeMode('parking')}>搵泊車位</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
