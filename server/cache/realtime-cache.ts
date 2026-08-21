import { REALTIME_FRESH_TTL_MS } from '../config';

export { REALTIME_FRESH_TTL_MS };

export interface RealtimeCacheOptions {
  now?: () => number;
  freshTtlMs?: number;
}

export interface RealtimeCacheResult<T> {
  value: T;
  stale: boolean;
  ageSeconds: number;
  error?: unknown;
}

interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

export type RealtimeLoader<T> = () => Promise<T> | T;

export class RealtimeCache<T = unknown> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly pending = new Map<string, Promise<RealtimeCacheResult<T>>>();
  private readonly now: () => number;
  private readonly freshTtlMs: number;

  constructor(options: RealtimeCacheOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.freshTtlMs = options.freshTtlMs ?? REALTIME_FRESH_TTL_MS;
  }

  get(key: string, loader: RealtimeLoader<T>): Promise<RealtimeCacheResult<T>> {
    const currentTime = this.now();
    const entry = this.entries.get(key);
    if (entry && currentTime - entry.storedAt < this.freshTtlMs) {
      return Promise.resolve(this.result(entry, false, currentTime));
    }

    const existing = this.pending.get(key);
    if (existing) {
      return existing;
    }

    const pending = Promise.resolve()
      .then(loader)
      .then((value) => {
        const storedAt = this.now();
        const nextEntry: CacheEntry<T> = { value, storedAt };
        this.entries.set(key, nextEntry);
        return this.result(nextEntry, false, storedAt);
      })
      .catch((error: unknown) => {
        const staleEntry = this.entries.get(key);
        if (!staleEntry) {
          throw error;
        }
        return {
          ...this.result(staleEntry, true, this.now()),
          error,
        };
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, pending);
    return pending;
  }

  clear(): void {
    this.entries.clear();
  }

  private result(entry: CacheEntry<T>, stale: boolean, currentTime: number): RealtimeCacheResult<T> {
    const ageMilliseconds = Math.max(0, currentTime - entry.storedAt);
    return {
      value: entry.value,
      stale,
      ageSeconds: Math.floor(ageMilliseconds / 1_000),
    };
  }
}
