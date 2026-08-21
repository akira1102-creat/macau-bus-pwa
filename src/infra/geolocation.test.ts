import { describe, expect, it, vi } from 'vitest';

import { getCurrentPositionOnce } from './geolocation';
import type { CurrentPositionError } from './geolocation';

describe('one-shot browser geolocation', () => {
  it('resolves a sanitized position after exactly one getCurrentPosition call', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude: 22.198,
          longitude: 113.543,
          accuracy: 8,
        } as GeolocationCoordinates,
        timestamp: Date.now(),
      } as GeolocationPosition);
    });

    const position = await getCurrentPositionOnce({
      geolocation: { getCurrentPosition } as Pick<Geolocation, 'getCurrentPosition'>,
    });

    expect(position).toEqual({ latitude: 22.198, longitude: 113.543, accuracyMeters: 8 });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('rejects permission denial without sending or logging a coordinate', async () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) => {
      error({ code: 1, message: 'permission denied' } as GeolocationPositionError);
    });

    await expect(getCurrentPositionOnce({
      geolocation: { getCurrentPosition } as Pick<Geolocation, 'getCurrentPosition'>,
    })).rejects.toMatchObject({
      name: 'CurrentPositionError',
      code: 'permission-denied',
    } satisfies Partial<CurrentPositionError>);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });
});
