import type { ReactNode } from 'react';
import { Bell, BusFront, Map, MapPin, Settings, Star } from 'lucide-react';

import type { AppTab } from '../app/router';
import { messages } from '../i18n/messages';

interface AppShellProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  children: ReactNode;
  title?: string;
  showHeader?: boolean;
}

const tabs: Array<{ id: AppTab; label: string; icon: typeof MapPin }> = [
  { id: 'nearby', label: messages.nearby, icon: MapPin },
  { id: 'routes', label: messages.routes, icon: BusFront },
  { id: 'map', label: messages.map, icon: Map },
  { id: 'favorites', label: messages.favorites, icon: Star },
  { id: 'settings', label: messages.settings, icon: Settings },
];

export function AppShell({ activeTab, onTabChange, children, title = messages.appName, showHeader = true }: AppShellProps) {
  return (
    <div className="app-shell">
      {showHeader ? (
        <header className="app-header">
          <h1>{title}</h1>
          <span className="icon-button" aria-hidden="true" title="通知">
            <Bell aria-hidden="true" size={25} strokeWidth={1.8} />
          </span>
        </header>
      ) : null}
      <main className="app-content">{children}</main>
      <nav className="bottom-nav" aria-label="主要導覽">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            className={`bottom-nav-item${activeTab === id ? ' is-active' : ''}`}
            type="button"
            key={id}
            aria-current={activeTab === id ? 'page' : undefined}
            onClick={() => onTabChange(id)}
          >
            <Icon aria-hidden="true" size={27} strokeWidth={activeTab === id ? 2.2 : 1.7} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
