import { describe, expect, it, vi } from 'vitest';

import type { ParkingSnapshot } from '../../shared/parking-contract';
import { ParkingAdmissionError, ParkingRefreshAdmission } from './runtime';

const snapshot: ParkingSnapshot = {
  updatedAt: '2026-08-22T02:00:00.000Z',
  stale: false,
  facilities: [],
};

describe('ParkingRefreshAdmission', () => {
  it('coalesces concurrent refreshes and serves a valid stale fallback during cooldown', async () => {
    let now = 1_000;
    let resolve: ((value: ParkingSnapshot) => void) | undefined;
    const loader = vi.fn(() => new Promise<ParkingSnapshot>((nextResolve) => {
      resolve = nextResolve;
    }));
    const admission = new ParkingRefreshAdmission({ now: () => now, cooldownMs: 5_000 });

    const first = admission.fetch(loader);
    const second = admission.fetch(loader);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    resolve?.(snapshot);

    await expect(Promise.all([first, second])).resolves.toEqual([snapshot, snapshot]);
    now += 100;
    await expect(admission.fetch(loader)).resolves.toMatchObject({ stale: true, facilities: [] });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('blocks repeated failed refreshes without a cached success until cooldown expires', async () => {
    let now = 1_000;
    const loader = vi.fn(async () => { throw new Error('synthetic upstream'); });
    const admission = new ParkingRefreshAdmission({ now: () => now, cooldownMs: 5_000 });

    await expect(admission.fetch(loader)).rejects.toThrow('synthetic upstream');
    await expect(admission.fetch(loader)).rejects.toBeInstanceOf(ParkingAdmissionError);
    expect(loader).toHaveBeenCalledTimes(1);
    now += 5_001;
    await expect(admission.fetch(loader)).rejects.toThrow('synthetic upstream');
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
