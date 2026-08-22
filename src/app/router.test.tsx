// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { getNavigationTabs, parseRoute, routeUrl } from './router';

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

  it('parses parking list, search and detail deep links without changing bus routes', () => {
    expect(parseRoute(new URL('https://example.test/?mode=parking&tab=search&q=%E6%B0%B4%E5%9D%91') as unknown as Location)).toEqual({
      mode: 'parking',
      tab: 'search',
      query: '水坑',
    });
    expect(parseRoute(new URL('https://example.test/?mode=parking&tab=detail&parking=42') as unknown as Location)).toEqual({
      mode: 'parking',
      tab: 'detail',
      parkingId: '42',
    });
    expect(parseRoute(new URL('https://example.test/?tab=routes&route=1&direction=0') as unknown as Location)).toEqual({
      tab: 'routes',
      routeId: '1',
      directionId: 0,
    });
  });

  it('preserves the parking detail return source and search query in deep links', () => {
    const parsed = parseRoute(new URL('https://example.test/?mode=parking&tab=detail&parking=42&from=map&q=%E6%B0%B4%E5%9D%91') as unknown as Location);

    expect(parsed).toEqual({
      mode: 'parking',
      tab: 'detail',
      parkingId: '42',
      query: '水坑',
      sourceTab: 'map',
    });
    window.history.replaceState(null, '', '/macau-bus-pwa/');
    expect(routeUrl(parsed)).toBe('/macau-bus-pwa/?mode=parking&tab=detail&parking=42&q=%E6%B0%B4%E5%9D%91&from=map');
  });

  it('resolves legacy bus route deep links even when parking mode is remembered', () => {
    const parsed = parseRoute(
      new URL('https://example.test/?tab=routes&route=1&direction=1') as unknown as Location,
      'parking',
    );

    expect(parsed).toEqual({ mode: 'bus', tab: 'routes', routeId: '1', directionId: 1 });
  });

  it('keeps an explicit bus mode when parsing and navigating over a parking preference', () => {
    const parsed = parseRoute(
      new URL('https://example.test/?mode=bus&tab=routes&route=1&direction=0') as unknown as Location,
      'parking',
    );

    expect(parsed).toEqual({ mode: 'bus', tab: 'routes', routeId: '1', directionId: 0 });
    window.history.replaceState(null, '', '/macau-bus-pwa/');
    expect(routeUrl(parsed)).toBe('/macau-bus-pwa/?mode=bus&tab=routes&route=1&direction=0');
  });

  it('round-trips a parking detail URL and exposes exact mode navigation sets', () => {
    const parkingRoute = { mode: 'parking' as const, tab: 'detail' as const, parkingId: '42' };
    window.history.replaceState(null, '', '/macau-bus-pwa/');
    expect(routeUrl(parkingRoute)).toBe('/macau-bus-pwa/?mode=parking&tab=detail&parking=42');
    expect(getNavigationTabs('bus')).toEqual(['nearby', 'routes', 'map', 'favorites', 'settings']);
    expect(getNavigationTabs('parking')).toEqual(['nearby', 'map', 'search', 'favorites', 'settings']);
  });
});
