import { z } from 'zod';

export const PREFERENCES_STORAGE_KEY = 'macau-bus-pwa:preferences:v1';
export const LOCAL_PREFERENCES_KEY = PREFERENCES_STORAGE_KEY;

export const ThemeSchema = z.enum(['system', 'light', 'dark']);
export type Theme = z.infer<typeof ThemeSchema>;

export const AppModeSchema = z.enum(['bus', 'parking']);
export type AppMode = z.infer<typeof AppModeSchema>;

export const PreferencesSchema = z.object({
  version: z.literal(3),
  favorites: z.array(z.string().trim().min(1)),
  recent: z.array(z.string().trim().min(1)),
  theme: ThemeSchema,
  notificationLeadStops: z.number().int().min(1).max(10),
  activeMode: AppModeSchema.nullable(),
  parkingFavorites: z.array(z.string().trim().min(1)),
  parkingAlertThreshold: z.number().int().min(1).max(100),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = {
  version: 3,
  favorites: [],
  recent: [],
  theme: 'system',
  notificationLeadStops: 3,
  activeMode: null,
  parkingFavorites: [],
  parkingAlertThreshold: 10,
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
    notificationLeadStops: DEFAULT_PREFERENCES.notificationLeadStops,
    activeMode: DEFAULT_PREFERENCES.activeMode,
    parkingFavorites: [],
    parkingAlertThreshold: DEFAULT_PREFERENCES.parkingAlertThreshold,
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

const storageFallbacks = new WeakMap<PreferencesStorage, Map<string, Preferences>>();
const noStorageFallbacks = new Map<string, Preferences>();

function clonePreferences(value: Preferences): Preferences {
  return {
    version: value.version,
    favorites: [...value.favorites],
    recent: [...value.recent],
    theme: value.theme,
    notificationLeadStops: value.notificationLeadStops,
    activeMode: value.activeMode,
    parkingFavorites: [...value.parkingFavorites],
    parkingAlertThreshold: value.parkingAlertThreshold,
  };
}

function getStorageFallback(storage: PreferencesStorage, key: string): Preferences | undefined {
  return storageFallbacks.get(storage)?.get(key);
}

function rememberStorageFallback(storage: PreferencesStorage, key: string, value: Preferences): void {
  let values = storageFallbacks.get(storage);
  if (!values) {
    values = new Map<string, Preferences>();
    storageFallbacks.set(storage, values);
  }
  values.set(key, clonePreferences(value));
}

function forgetStorageFallback(storage: PreferencesStorage, key: string): void {
  const values = storageFallbacks.get(storage);
  values?.delete(key);
  if (values?.size === 0) {
    storageFallbacks.delete(storage);
  }
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

function normalizeLeadStops(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10
    ? value
    : DEFAULT_PREFERENCES.notificationLeadStops;
}

function normalizeActiveMode(value: unknown): AppMode | null {
  return value === 'bus' || value === 'parking' ? value : null;
}

function normalizeParkingThreshold(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100
    ? value
    : DEFAULT_PREFERENCES.parkingAlertThreshold;
}

function normalizePreferences(value: Pick<Preferences, 'favorites' | 'recent' | 'theme'> & {
  notificationLeadStops?: unknown;
  activeMode?: unknown;
  parkingFavorites?: unknown;
  parkingAlertThreshold?: unknown;
}): Preferences {
  return {
    version: 3,
    favorites: uniqueStrings(value.favorites),
    recent: uniqueStrings(value.recent, 10),
    theme: value.theme,
    notificationLeadStops: normalizeLeadStops(value.notificationLeadStops),
    activeMode: normalizeActiveMode(value.activeMode),
    parkingFavorites: uniqueStrings(Array.isArray(value.parkingFavorites) ? value.parkingFavorites.filter((candidate): candidate is string => typeof candidate === 'string') : []),
    parkingAlertThreshold: normalizeParkingThreshold(value.parkingAlertThreshold),
  };
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === 'string')
    : [];
}

const StoredPreferencesSchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  favorites: z.array(z.string().trim().min(1)),
  recent: z.array(z.string().trim().min(1)),
  theme: ThemeSchema,
  notificationLeadStops: z.unknown().optional(),
  activeMode: z.unknown().optional(),
  parkingFavorites: z.unknown().optional(),
  parkingAlertThreshold: z.unknown().optional(),
});

function persistLoadedPreferences(storage: PreferencesStorage, key: string, preferences: Preferences): void {
  try {
    storage.setItem(key, JSON.stringify(preferences));
    forgetStorageFallback(storage, key);
  } catch {
    rememberStorageFallback(storage, key, preferences);
  }
}

export function loadPreferences(options: PreferencesOptions = {}): Preferences {
  const storage = resolveStorage(options);
  const key = resolveKey(options);
  if (!storage) {
    return clonePreferences(noStorageFallbacks.get(key) ?? copyDefault());
  }
  const fallback = getStorageFallback(storage, key);
  if (fallback) {
    return clonePreferences(fallback);
  }
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return copyDefault();
  }
  if (raw === null) {
    return copyDefault();
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const validated = StoredPreferencesSchema.safeParse(parsed);
    if (!validated.success) {
      storage.removeItem(key);
      return copyDefault();
    }
    const normalized = normalizePreferences(validated.data);
    if (
      validated.data.version !== normalized.version
      || validated.data.notificationLeadStops !== normalized.notificationLeadStops
      || validated.data.activeMode !== normalized.activeMode
      || JSON.stringify(validated.data.parkingFavorites ?? null) !== JSON.stringify(normalized.parkingFavorites)
      || validated.data.parkingAlertThreshold !== normalized.parkingAlertThreshold
    ) {
      persistLoadedPreferences(storage, key, normalized);
    }
    return normalized;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // A read-only or unavailable storage should still recover in memory.
    }
    return copyDefault();
  }
}

export function savePreferences(preferences: Preferences, options: PreferencesOptions = {}): Preferences {
  const normalized = normalizePreferences({
    favorites: stringValues(preferences.favorites),
    recent: stringValues(preferences.recent),
    theme: ThemeSchema.parse(preferences.theme),
    notificationLeadStops: preferences.notificationLeadStops,
    activeMode: preferences.activeMode,
    parkingFavorites: stringValues(preferences.parkingFavorites),
    parkingAlertThreshold: preferences.parkingAlertThreshold,
  });
  const storage = resolveStorage(options);
  const key = resolveKey(options);
  if (!storage) {
    noStorageFallbacks.set(key, clonePreferences(normalized));
    return normalized;
  }
  try {
    storage.setItem(key, JSON.stringify(normalized));
    forgetStorageFallback(storage, key);
  } catch {
    rememberStorageFallback(storage, key, normalized);
    // Private-mode/quota failures leave the normalized value available to the
    // in-memory store; callers must not lose an interaction to persistence.
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
  getNotificationLeadStops(): number;
  setNotificationLeadStops(value: number): Preferences;
  getActiveMode(): AppMode | null;
  setActiveMode(mode: AppMode | null): Preferences;
  getParkingFavorites(): string[];
  setParkingFavorites(favorites: readonly string[]): Preferences;
  toggleParkingFavorite(parkingId: string): Preferences;
  getParkingAlertThreshold(): number;
  setParkingAlertThreshold(value: number): Preferences;
}

export function createLocalPreferences(options: LocalPreferencesOptions = {}): LocalPreferences {
  const storageKey = resolveKey(options);
  const storageOptions: PreferencesOptions = {
    ...(options.storage === undefined ? {} : { storage: options.storage }),
    storageKey,
  };
  let inMemory: Preferences | undefined;
  const read = (): Preferences => inMemory ?? loadPreferences(storageOptions);
  const persist = (preferences: Preferences): Preferences => {
    const normalized = savePreferences(preferences, storageOptions);
    inMemory = normalized;
    return normalized;
  };
  return {
    storageKey,
    appRelease: options.appRelease,
    get: read,
    set: persist,
    getFavorites: () => read().favorites,
    setFavorites: (favorites) => {
      const current = read();
      return persist({ ...current, favorites: [...favorites] });
    },
    toggleFavorite: (routeId) => {
      const current = read();
      const normalized = routeId.trim();
      if (!normalized) {
        return current;
      }
      const favorites = current.favorites.includes(normalized)
        ? current.favorites.filter((candidate) => candidate !== normalized)
        : [normalized, ...current.favorites];
      return persist({ ...current, favorites });
    },
    getRecent: () => read().recent,
    addRecent: (routeId) => {
      const current = read();
      const normalized = routeId.trim();
      const recent = normalized
        ? [normalized, ...current.recent.filter((candidate) => candidate !== normalized)].slice(0, 10)
        : current.recent;
      return persist({ ...current, recent });
    },
    getTheme: () => read().theme,
    setTheme: (theme) => {
      const current = read();
      return persist({ ...current, theme });
    },
    getNotificationLeadStops: () => read().notificationLeadStops,
    setNotificationLeadStops: (value) => {
      const current = read();
      return persist({ ...current, notificationLeadStops: normalizeLeadStops(value) });
    },
    getActiveMode: () => read().activeMode,
    setActiveMode: (mode) => {
      const current = read();
      return persist({ ...current, activeMode: normalizeActiveMode(mode) });
    },
    getParkingFavorites: () => read().parkingFavorites,
    setParkingFavorites: (favorites) => {
      const current = read();
      return persist({ ...current, parkingFavorites: [...favorites] });
    },
    toggleParkingFavorite: (parkingId) => {
      const current = read();
      const normalized = parkingId.trim();
      if (!normalized) {
        return current;
      }
      const parkingFavorites = current.parkingFavorites.includes(normalized)
        ? current.parkingFavorites.filter((candidate) => candidate !== normalized)
        : [normalized, ...current.parkingFavorites];
      return persist({ ...current, parkingFavorites });
    },
    getParkingAlertThreshold: () => read().parkingAlertThreshold,
    setParkingAlertThreshold: (value) => {
      const current = read();
      return persist({ ...current, parkingAlertThreshold: normalizeParkingThreshold(value) });
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

export function getNotificationLeadStops(options: PreferencesOptions = {}): number {
  return loadPreferences(options).notificationLeadStops;
}

export function setNotificationLeadStops(value: number, options: PreferencesOptions = {}): Preferences {
  const current = loadPreferences(options);
  return savePreferences({ ...current, notificationLeadStops: normalizeLeadStops(value) }, options);
}

export function getActiveMode(options: PreferencesOptions = {}): AppMode | null {
  return loadPreferences(options).activeMode;
}

export function setActiveMode(mode: AppMode | null, options: PreferencesOptions = {}): Preferences {
  const current = loadPreferences(options);
  return savePreferences({ ...current, activeMode: normalizeActiveMode(mode) }, options);
}

export function getParkingFavorites(options: PreferencesOptions = {}): string[] {
  return loadPreferences(options).parkingFavorites;
}

export function setParkingFavorites(favorites: readonly string[], options: PreferencesOptions = {}): Preferences {
  const current = loadPreferences(options);
  return savePreferences({ ...current, parkingFavorites: [...favorites] }, options);
}

export function getParkingAlertThreshold(options: PreferencesOptions = {}): number {
  return loadPreferences(options).parkingAlertThreshold;
}

export function setParkingAlertThreshold(value: number, options: PreferencesOptions = {}): Preferences {
  const current = loadPreferences(options);
  return savePreferences({ ...current, parkingAlertThreshold: normalizeParkingThreshold(value) }, options);
}
