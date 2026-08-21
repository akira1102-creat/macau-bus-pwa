import { z } from 'zod';

export const PREFERENCES_STORAGE_KEY = 'macau-bus-pwa:preferences:v1';
export const LOCAL_PREFERENCES_KEY = PREFERENCES_STORAGE_KEY;

export const ThemeSchema = z.enum(['system', 'light', 'dark']);
export type Theme = z.infer<typeof ThemeSchema>;

export const PreferencesSchema = z.object({
  version: z.literal(1),
  favorites: z.array(z.string().trim().min(1)),
  recent: z.array(z.string().trim().min(1)),
  theme: ThemeSchema,
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = {
  version: 1,
  favorites: [],
  recent: [],
  theme: 'system',
};

/** Minimal Storage surface keeps this adapter testable without a browser or network. */
export interface PreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PreferencesOptions {
  storage?: PreferencesStorage;
  storageKey?: string;
  /** Alias useful for callers that already use a generic key option. */
  key?: string;
}

export interface LocalPreferencesOptions extends PreferencesOptions {
  /** Informational only; deliberately not part of the storage key. */
  appRelease?: string;
}

function copyDefault(): Preferences {
  return {
    version: DEFAULT_PREFERENCES.version,
    favorites: [],
    recent: [],
    theme: DEFAULT_PREFERENCES.theme,
  };
}

function browserStorage(): PreferencesStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function resolveStorage(options: PreferencesOptions): PreferencesStorage | undefined {
  return options.storage ?? browserStorage();
}

function resolveKey(options: PreferencesOptions): string {
  return options.storageKey ?? options.key ?? PREFERENCES_STORAGE_KEY;
}

function uniqueStrings(values: readonly string[], max = Number.POSITIVE_INFINITY): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= max) {
      break;
    }
  }
  return result;
}

function normalizePreferences(value: Preferences): Preferences {
  return {
    version: 1,
    favorites: uniqueStrings(value.favorites),
    recent: uniqueStrings(value.recent, 10),
    theme: value.theme,
  };
}

export function loadPreferences(options: PreferencesOptions = {}): Preferences {
  const storage = resolveStorage(options);
  if (!storage) {
    return copyDefault();
  }
  let raw: string | null;
  try {
    raw = storage.getItem(resolveKey(options));
  } catch {
    return copyDefault();
  }
  if (raw === null) {
    return copyDefault();
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const validated = PreferencesSchema.safeParse(parsed);
    if (!validated.success) {
      storage.removeItem(resolveKey(options));
      return copyDefault();
    }
    return normalizePreferences(validated.data);
  } catch {
    try {
      storage.removeItem(resolveKey(options));
    } catch {
      // A read-only or unavailable storage should still recover in memory.
    }
    return copyDefault();
  }
}

export function savePreferences(preferences: Preferences, options: PreferencesOptions = {}): Preferences {
  const normalized = normalizePreferences(PreferencesSchema.parse(preferences));
  const storage = resolveStorage(options);
  if (storage) {
    storage.setItem(resolveKey(options), JSON.stringify(normalized));
  }
  return normalized;
}

export interface LocalPreferences {
  readonly storageKey: string;
  readonly appRelease: string | undefined;
  get(): Preferences;
  set(preferences: Preferences): Preferences;
  getFavorites(): string[];
  setFavorites(favorites: readonly string[]): Preferences;
  toggleFavorite(routeId: string): Preferences;
  getRecent(): string[];
  addRecent(routeId: string): Preferences;
  getTheme(): Theme;
  setTheme(theme: Theme): Preferences;
}

export function createLocalPreferences(options: LocalPreferencesOptions = {}): LocalPreferences {
  const storageKey = resolveKey(options);
  const storageOptions: PreferencesOptions = {
    ...(options.storage === undefined ? {} : { storage: options.storage }),
    storageKey,
  };
  return {
    storageKey,
    appRelease: options.appRelease,
    get: () => loadPreferences(storageOptions),
    set: (preferences) => savePreferences(preferences, storageOptions),
    getFavorites: () => loadPreferences(storageOptions).favorites,
    setFavorites: (favorites) => {
      const current = loadPreferences(storageOptions);
      return savePreferences({ ...current, favorites: [...favorites] }, storageOptions);
    },
    toggleFavorite: (routeId) => {
      const current = loadPreferences(storageOptions);
      const normalized = routeId.trim();
      const favorites = current.favorites.includes(normalized)
        ? current.favorites.filter((candidate) => candidate !== normalized)
        : [normalized, ...current.favorites];
      return savePreferences({ ...current, favorites }, storageOptions);
    },
    getRecent: () => loadPreferences(storageOptions).recent,
    addRecent: (routeId) => {
      const current = loadPreferences(storageOptions);
      const normalized = routeId.trim();
      const recent = normalized
        ? [normalized, ...current.recent.filter((candidate) => candidate !== normalized)].slice(0, 10)
        : current.recent;
      return savePreferences({ ...current, recent }, storageOptions);
    },
    getTheme: () => loadPreferences(storageOptions).theme,
    setTheme: (theme) => {
      const current = loadPreferences(storageOptions);
      return savePreferences({ ...current, theme }, storageOptions);
    },
  };
}

export const getPreferences = loadPreferences;
export const readPreferences = loadPreferences;
export const writePreferences = savePreferences;

export function getFavorites(options: PreferencesOptions = {}): string[] {
  return loadPreferences(options).favorites;
}

export function setFavorites(favorites: readonly string[], options: PreferencesOptions = {}): Preferences {
  const current = loadPreferences(options);
  return savePreferences({ ...current, favorites: [...favorites] }, options);
}

export function getRecent(options: PreferencesOptions = {}): string[] {
  return loadPreferences(options).recent;
}

export function addRecent(routeId: string, options: PreferencesOptions = {}): Preferences {
  const current = loadPreferences(options);
  const normalized = routeId.trim();
  const recent = normalized
    ? [normalized, ...current.recent.filter((candidate) => candidate !== normalized)].slice(0, 10)
    : current.recent;
  return savePreferences({ ...current, recent }, options);
}

export function getTheme(options: PreferencesOptions = {}): Theme {
  return loadPreferences(options).theme;
}

export function setTheme(theme: Theme, options: PreferencesOptions = {}): Preferences {
  const current = loadPreferences(options);
  return savePreferences({ ...current, theme }, options);
}
