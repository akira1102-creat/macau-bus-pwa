import { afterEach, describe, expect, it } from 'vitest';

import {
  createLocalPreferences,
  DEFAULT_PREFERENCES,
  loadPreferences,
  type PreferencesStorage,
} from './local-preferences';

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

class QuotaStorage extends MemoryStorage {
  override setItem(): void {
    throw new Error('storage quota exceeded');
  }
}

const storages: MemoryStorage[] = [];

function createStorage(): MemoryStorage {
  const storage = new MemoryStorage();
  storages.push(storage);
  return storage;
}

afterEach(() => {
  storages.length = 0;
});

describe('versioned local preferences', () => {
  it('validates the stored schema and recovers defaults from corrupt JSON', () => {
    const storage = createStorage();
    const preferences = createLocalPreferences({ storage });

    storage.setItem(preferences.storageKey, JSON.stringify({ version: 99, favorites: ['bad'] }));
    expect(loadPreferences({ storage })).toEqual(DEFAULT_PREFERENCES);

    storage.setItem(preferences.storageKey, '{not-json');
    expect(loadPreferences({ storage })).toEqual(DEFAULT_PREFERENCES);
  });

  it('caps recent route ids at ten while moving duplicates to the front', () => {
    const storage = createStorage();
    const preferences = createLocalPreferences({ storage });

    for (let index = 0; index < 12; index += 1) {
      preferences.addRecent(`route-${index}`);
    }
    preferences.addRecent('route-5');

    expect(preferences.getRecent()).toHaveLength(10);
    expect(preferences.getRecent()[0]).toBe('route-5');
    expect(preferences.getRecent()).not.toContain('route-0');
  });

  it('keeps the profile when a PWA asset release changes', () => {
    const storage = createStorage();
    const firstRelease = createLocalPreferences({ storage, appRelease: 'shell-1' });

    firstRelease.setFavorites(['1', '26A']);
    firstRelease.setTheme('dark');

    const updatedRelease = createLocalPreferences({ storage, appRelease: 'shell-2' });

    expect(updatedRelease.getFavorites()).toEqual(['1', '26A']);
    expect(updatedRelease.getTheme()).toBe('dark');
  });

  it('keeps preference actions safe when localStorage setItem is unavailable', () => {
    const preferences = createLocalPreferences({ storage: new QuotaStorage() });

    expect(() => preferences.setFavorites(['1'])).not.toThrow();
    expect(() => preferences.addRecent('1')).not.toThrow();
    expect(() => preferences.setTheme('dark')).not.toThrow();
    expect(preferences.getFavorites()).toEqual(['1']);
    expect(preferences.getRecent()).toEqual(['1']);
    expect(preferences.getTheme()).toBe('dark');
  });
});
