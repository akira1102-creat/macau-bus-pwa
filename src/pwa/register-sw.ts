export interface ServiceWorkerRegistrationLike {
  waiting: ServiceWorker | null;
  installing: ServiceWorker | null;
  update(): Promise<void>;
  addEventListener(type: 'updatefound', listener: () => void): void;
}

export function createReloadGuard(): () => boolean {
  let reloadRequested = false;
  return () => {
    if (reloadRequested) {
      return false;
    }
    reloadRequested = true;
    return true;
  };
}

export function canActivateWaitingWorker(state: string | undefined, hasController: boolean): boolean {
  return state === 'installed' && hasController;
}

export function shouldCheckOnVisibility(state: string): boolean {
  return state === 'visible';
}

export function shouldReloadAfterControllerChange(hasPreviousController: boolean): boolean {
  return hasPreviousController;
}

function sendSkipWaiting(worker: ServiceWorker | null | undefined, hasController: boolean): void {
  if (canActivateWaitingWorker(worker?.state, hasController)) {
    worker?.postMessage({ type: 'SKIP_WAITING' });
  }
}

/** Register the app worker and converge to a new release without touching app storage. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return undefined;
  }

  const shouldReload = createReloadGuard();
  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const isUpdateHandoff = hadController;
    hadController = true;
    if (!shouldReloadAfterControllerChange(isUpdateHandoff)) {
      return;
    }
    if (shouldReload()) {
      window.location.reload();
    }
  });

  const workerUrl = new URL('sw.js', document.baseURI).toString();
  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.register(workerUrl, { updateViaCache: 'none' });
  } catch {
    return undefined;
  }
  const activateWaiting = () => sendSkipWaiting(registration.waiting, Boolean(navigator.serviceWorker.controller));

  activateWaiting();
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed') {
        sendSkipWaiting(installing, Boolean(navigator.serviceWorker.controller));
      }
    });
  });

  const checkForUpdate = () => registration.update().catch(() => undefined);
  void checkForUpdate();
  window.addEventListener('pageshow', () => {
    void checkForUpdate();
  });
  document.addEventListener('visibilitychange', () => {
    if (shouldCheckOnVisibility(document.visibilityState)) {
      void checkForUpdate();
    }
  });

  return registration;
}
