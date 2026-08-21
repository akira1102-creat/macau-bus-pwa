import { describe, expect, it } from 'vitest';

import {
  canActivateWaitingWorker,
  createReloadGuard,
  shouldReloadAfterControllerChange,
  shouldCheckOnVisibility,
} from './register-sw';

describe('PWA update lifecycle guards', () => {
  it('allows one reload after a worker takes control and blocks repeats', () => {
    const shouldReload = createReloadGuard();

    expect(shouldReload()).toBe(true);
    expect(shouldReload()).toBe(false);
  });

  it('only activates an installed waiting worker when an existing controller exists', () => {
    expect(canActivateWaitingWorker('installed', true)).toBe(true);
    expect(canActivateWaitingWorker('installing', true)).toBe(false);
    expect(canActivateWaitingWorker('installed', false)).toBe(false);
  });

  it('checks for updates when the document returns to the visible state', () => {
    expect(shouldCheckOnVisibility('visible')).toBe(true);
    expect(shouldCheckOnVisibility('hidden')).toBe(false);
  });

  it('does not reload the first time a worker takes control', () => {
    expect(shouldReloadAfterControllerChange(false)).toBe(false);
    expect(shouldReloadAfterControllerChange(true)).toBe(true);
  });
});
