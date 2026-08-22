// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { parseRoute, routeUrl } from './router';

describe('app route direction navigation', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('round-trips a direction-aware route URL', () => {
    const parsed = parseRoute(new URL('https://example.test/macau-bus-pwa/?tab=routes&route=1&direction=1') as unknown as Location);

    expect(parsed).toEqual({ tab: 'routes', routeId: '1', directionId: 1 });
    window.history.replaceState(null, '', '/macau-bus-pwa/');
    expect(routeUrl(parsed)).toBe('/macau-bus-pwa/?tab=routes&route=1&direction=1');
  });

  it('ignores invalid direction values while keeping the selected route', () => {
    const parsed = parseRoute(new URL('https://example.test/?tab=routes&route=1&direction=2') as unknown as Location);

    expect(parsed).toEqual({ tab: 'routes', routeId: '1' });
  });
});
