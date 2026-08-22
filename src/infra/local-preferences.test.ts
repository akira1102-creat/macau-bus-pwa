import { afterEach, describe, expect, it } from 'vitest';

import {
  addRecent,
  createLocalPreferences,
  DEFAULT_PREFERENCES,
  getFavorites,
  getNotificationLeadStops,
  getRecent,
  getTheme,
  loadPreferences,
  setFavorites,
  setNotificationLeadStops,
  setTheme,
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

  it('migrates version-1 preferences to version 2 without losing saved values', () => {
    const storage = createStorage();
    const preferences = createLocalPreferences({ storage });
    storage.setItem(preferences.storageKey, JSON.stringify({
      version: 1,
      favorites: ['1'],
      recent: ['26A'],
      theme: 'dark',
    }));

    expect(preferences.get()).toEqual({
      version: 2,
      favorites: ['1'],
      recent: ['26A'],
      theme: 'dark',
      notificationLeadStops: 3,
    });
    expect(JSON.parse(storage.getItem(preferences.storageKey) ?? '{}')).toMatchObject({ version: 2, notificationLeadStops: 3 });
  });

  it.each([0, 11, 1.5, null, '3'])('normalizes invalid stored lead count %s to three', (value) => {
    const storage = createStorage();
    const preferences = createLocalPreferences({ storage });
    storage.setItem(preferences.storageKey, JSON.stringify({
      version: 2,
      favorites: ['1'],
      recent: [],
      theme: 'system',
      notificationLeadStops: value,
    }));

    expect(preferences.getNotificationLeadStops()).toBe(3);
    expect(preferences.getFavorites()).toEqual(['1']);
  });

  it('persists lead counts at the one and ten stop limits', () => {
    const storage = createStorage();
    const preferences = createLocalPreferences({ storage });

    expect(preferences.setNotificationLeadStops(1).notificationLeadStops).toBe(1);
    expect(preferences.getNotificationLeadStops()).toBe(1);
    expect(preferences.setNotificationLeadStops(10).notificationLeadStops).toBe(10);
    expect(getNotificationLeadStops({ storage })).toBe(10);
    expect(setNotificationLeadStops(1, { storage }).notificationLeadStops).toBe(1);
    expect(getNotificationLeadStops({ storage })).toBe(1);
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

  it('keeps top-level helper state in memory after a storage write failure', () => {
    const storage = new QuotaStorage();

    expect(() => setFavorites(['1'], { storage })).not.toThrow();
    expect(getFavorites({ storage })).toEqual(['1']);

    expect(() => addRecent('26A', { storage })).not.toThrow();
    expect(getRecent({ storage })).toEqual(['26A']);

    expect(() => setTheme('dark', { storage })).not.toThrow();
    expect(getTheme({ storage })).toBe('dark');
  });
});
