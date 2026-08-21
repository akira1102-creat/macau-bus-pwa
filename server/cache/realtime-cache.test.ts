import { describe, expect, it, vi } from 'vitest';

import { REALTIME_FRESH_TTL_MS, RealtimeCache } from './realtime-cache';

describe('RealtimeCache', () => {
  it('serves a fresh value for 12 seconds without invoking the loader again', async () => {
    let now = 1_000_000;
    const cache = new RealtimeCache<{ source: string }>({ now: () => now });
    const loader = vi.fn(async () => ({ source: 'upstream' }));

    const first = await cache.get('1|0', loader);
    now += REALTIME_FRESH_TTL_MS - 1;
    const second = await cache.get('1|0', loader);

    expect(first).toMatchObject({ value: { source: 'upstream' }, stale: false, ageSeconds: 0 });
    expect(second).toMatchObject({ value: { source: 'upstream' }, stale: false });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent misses to one Promise per route and direction', async () => {
    let resolveLoader: ((value: { source: string }) => void) | undefined;
    const cache = new RealtimeCache<{ source: string }>();
    const loader = vi.fn(() => new Promise<{ source: string }>((resolve) => {
      resolveLoader = resolve;
    }));

    const first = cache.get('26A|1', loader);
    const second = cache.get('26A|1', loader);
    await Promise.resolve();
    resolveLoader?.({ source: 'one request' });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { value: { source: 'one request' }, stale: false, ageSeconds: 0 },
      { value: { source: 'one request' }, stale: false, ageSeconds: 0 },
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('refreshes an expired value and returns stale data with age on upstream error', async () => {
    let now = 1_000_000;
    const cache = new RealtimeCache<{ source: string }>({ now: () => now });
    const loader = vi.fn()
      .mockResolvedValueOnce({ source: 'first' })
      .mockRejectedValueOnce(new Error('upstream unavailable'));

    await cache.get('1|1', loader);
    now += REALTIME_FRESH_TTL_MS + 3_000;
    const stale = await cache.get('1|1', loader);

    expect(stale.value).toEqual({ source: 'first' });
    expect(stale.stale).toBe(true);
    expect(stale.ageSeconds).toBe(15);
    expect(stale.error).toBeInstanceOf(Error);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('does not fabricate a value when the first upstream request fails', async () => {
    const cache = new RealtimeCache<{ source: string }>();
    const error = new Error('first request failed');

    await expect(cache.get('unknown|0', async () => {
      throw error;
    })).rejects.toBe(error);
  });
});
