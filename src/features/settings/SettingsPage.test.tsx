// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createLocalPreferences, type LocalPreferences, type PreferencesStorage } from '../../infra/local-preferences';
import { SettingsPage } from './SettingsPage';

class MemoryStorage implements PreferencesStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function preferences(): LocalPreferences {
  return createLocalPreferences({ storage: new MemoryStorage() });
}

describe('SettingsPage', () => {
  it('persists system, light and dark theme choices', () => {
    const preferenceStore = preferences();
    const onThemeChange = vi.fn();
    render(<SettingsPage preferences={preferenceStore} onThemeChange={onThemeChange} />);

    fireEvent.click(screen.getByRole('radio', { name: '深色' }));
    expect(preferenceStore.getTheme()).toBe('dark');
    expect(onThemeChange).toHaveBeenCalledWith('dark');

    fireEvent.click(screen.getByRole('radio', { name: '淺色' }));
    expect(preferenceStore.getTheme()).toBe('light');
    expect(onThemeChange).toHaveBeenCalledWith('light');
  });
});
