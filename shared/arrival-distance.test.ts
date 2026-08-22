import { describe, expect, it } from 'vitest';

import { remainingStopsToTarget } from './arrival-distance';

describe('remainingStopsToTarget', () => {
  it('returns the number of stops remaining for an exact current station match', () => {
    expect(remainingStopsToTarget(['A', 'B', 'C', 'D'], ' B ', 3)).toBe(2);
  });

  it('returns zero when the bus is at the target stop', () => {
    expect(remainingStopsToTarget(['A', 'B', 'C'], 'C', 2)).toBe(0);
  });

  it('uses the last repeated stop match at or before the target', () => {
    expect(remainingStopsToTarget(['A', 'B', 'A', 'C', 'A'], 'A', 3)).toBe(1);
    expect(remainingStopsToTarget(['A', 'B', 'A', 'C', 'A'], 'A', 4)).toBe(0);
  });

  it.each([
    ['negative target index', ['A', 'B'], 'A', -1],
    ['target index beyond route', ['A', 'B'], 'A', 2],
    ['empty route', [], 'A', 0],
  ])('returns null for %s', (_caseName, stopIds, currentStationCode, targetStopIndex) => {
    expect(remainingStopsToTarget(stopIds, currentStationCode, targetStopIndex)).toBeNull();
  });

  it('returns null when the current station is missing or occurs only after the target', () => {
    expect(remainingStopsToTarget(['A', 'B', 'C'], 'X', 2)).toBeNull();
    expect(remainingStopsToTarget(['A', 'B', 'C', 'D'], 'D', 2)).toBeNull();
  });
});
