import { Moon, Monitor, Sun } from 'lucide-react';
import { useState } from 'react';

import type { LocalPreferences, Theme } from '../../infra/local-preferences';
import { messages } from '../../i18n/messages';

interface SettingsPageProps {
  preferences: LocalPreferences;
  onThemeChange: (theme: Theme) => void;
}

const themeOptions: Array<{ value: Theme; label: string; icon: typeof Monitor }> = [
  { value: 'system', label: messages.system, icon: Monitor },
  { value: 'light', label: messages.light, icon: Sun },
  { value: 'dark', label: messages.dark, icon: Moon },
];

export function SettingsPage({ preferences, onThemeChange }: SettingsPageProps) {
  const [activeTheme, setActiveTheme] = useState<Theme>(() => preferences.getTheme());
  const handleThemeChange = (theme: Theme) => {
    preferences.setTheme(theme);
    setActiveTheme(theme);
    onThemeChange(theme);
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
      <section className="settings-section settings-note" aria-labelledby="privacy-title">
        <h2 id="privacy-title">本機資料</h2>
        <p>收藏、最近查看及顯示設定只儲存在此瀏覽器。定位只在本機計算，不會傳送至伺服器。</p>
      </section>
    </div>
  );
}
