import type { DirectionId } from '../../shared/transit-contract';

export const PUSH_IDENTITY_STORAGE_KEY = 'macau-bus-pwa:push:v1';

export interface PreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PushIdentity {
  subscriptionId: string;
  alertToken: string;
}

/** Public request shape accepted by the alert endpoint. */
export interface ArrivalAlertInput {
  /** `routeId` is the canonical Task 3 contract field. */
  routeId?: string;
  /** `route` remains accepted for callers using the initial frontend draft. */
  route?: string;
  direction: DirectionId;
  targetStopId: string;
  targetStopIndex: number;
  threshold: number;
}

export interface ArrivalAlertSummary {
  id: string;
  routeId: string;
  direction: DirectionId;
  targetStopId: string;
  targetStopIndex: number;
  threshold: number;
  createdAt?: string;
  expiresAt?: string;
}

export interface ParkingAlertInput {
  parkingId: string;
  parkingName: string;
  threshold: number;
}

export interface ParkingAlertSummary {
  id: string;
  parkingId: string;
  parkingName: string;
  threshold: number;
  createdAt?: string;
  expiresAt?: string;
}

export type PushSupportReason = 'notification-unavailable' | 'push-unavailable' | 'service-worker-unavailable' | 'ios-not-standalone';

export interface PushPlatform {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  displayModeStandalone?: boolean;
}

export interface PushSupport {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  reason?: PushSupportReason;
}

export type PushClientErrorCode =
  | 'unsupported'
  | 'permission-denied'
  | 'invalid-request'
  | 'network'
  | 'http'
  | 'invalid-response';

export class PushClientError extends Error {
  readonly code: PushClientErrorCode;
  readonly status: number | undefined;

  constructor(code: PushClientErrorCode, details: { status?: number } = {}) {
    super(`push request failed: ${code}`);
    this.name = 'PushClientError';
    this.code = code;
    this.status = details.status;
  }
}

export interface PushClientOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  storage?: PreferencesStorage;
  serviceWorker?: Pick<ServiceWorkerContainer, 'ready'>;
  serviceWorkerRegistration?: ServiceWorkerRegistration;
  getServiceWorkerRegistration?: () => Promise<ServiceWorkerRegistration>;
  pushManager?: Pick<PushManager, 'subscribe'>;
  notification?: Pick<typeof Notification, 'permission' | 'requestPermission'>;
  platform?: PushPlatform;
}

export interface PushClient {
  support(): PushSupport;
  prepare?: () => Promise<void>;
  listAlerts(): Promise<ArrivalAlertSummary[]>;
  createAlert(input: ArrivalAlertInput): Promise<ArrivalAlertSummary>;
  deleteAlert(id: string): Promise<void>;
  listParkingAlerts?: () => Promise<ParkingAlertSummary[]>;
  createParkingAlert?: (input: ParkingAlertInput) => Promise<ParkingAlertSummary>;
  deleteParkingAlert?: (id: string) => Promise<void>;
}

function defaultStorage(): PreferencesStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function notificationApi(options: PushClientOptions): Pick<typeof Notification, 'permission' | 'requestPermission'> | undefined {
  if (options.notification !== undefined) {
    return options.notification;
  }
  return typeof globalThis.Notification === 'undefined' ? undefined : globalThis.Notification;
}

function serviceWorkerApi(options: PushClientOptions): Pick<ServiceWorkerContainer, 'ready'> | undefined {
  if (options.serviceWorker !== undefined) {
    return options.serviceWorker;
  }
  const container = globalThis.navigator?.serviceWorker;
  return container ? { ready: container.ready } : undefined;
}

function hasPushManager(options: PushClientOptions): boolean {
  return options.pushManager !== undefined || typeof globalThis.PushManager !== 'undefined';
}

function apiPrefix(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) {
    return '/api';
  }
  return /(?:^|\/)api$/.test(normalized) ? normalized : `${normalized}/api`;
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function identityFrom(value: unknown): PushIdentity | undefined {
  const candidate = parseJsonObject(value);
  const nested = candidate?.identity;
  const source = parseJsonObject(nested) ?? candidate;
  const subscriptionId = typeof source?.subscriptionId === 'string'
    ? source.subscriptionId.trim()
    : typeof source?.id === 'string'
      ? source.id.trim()
      : '';
  const alertToken = typeof source?.alertToken === 'string'
    ? source.alertToken.trim()
    : typeof source?.token === 'string'
      ? source.token.trim()
      : '';
  return subscriptionId && alertToken ? { subscriptionId, alertToken } : undefined;
}

function alertInputValues(input: ArrivalAlertInput): { routeId: string; direction: DirectionId; targetStopId: string; targetStopIndex: number; threshold: number } {
  const routeId = (input.routeId ?? input.route ?? '').trim();
  const targetStopId = input.targetStopId.trim();
  if (!routeId || !targetStopId || (input.direction !== 0 && input.direction !== 1)
    || !Number.isInteger(input.targetStopIndex) || input.targetStopIndex < 0
    || !Number.isInteger(input.threshold) || input.threshold < 1 || input.threshold > 10) {
    throw new PushClientError('invalid-request');
  }
  return {
    routeId,
    direction: input.direction,
    targetStopId,
    targetStopIndex: input.targetStopIndex,
    threshold: input.threshold,
  };
}

function parkingAlertInputValues(input: ParkingAlertInput): ParkingAlertInput {
  const parkingId = input.parkingId.trim();
  const parkingName = input.parkingName.trim();
  if (!parkingId || parkingId.length > 64 || !parkingName || parkingName.length > 200
    || !Number.isInteger(input.threshold) || input.threshold < 1 || input.threshold > 100) {
    throw new PushClientError('invalid-request');
  }
  return { parkingId, parkingName, threshold: input.threshold };
}

function alertFrom(value: unknown): ArrivalAlertSummary | undefined {
  const candidate = parseJsonObject(value);
  if (!candidate) {
    return undefined;
  }
  const id = typeof candidate.id === 'string'
    ? candidate.id.trim()
    : typeof candidate.alertId === 'string'
      ? candidate.alertId.trim()
      : '';
  const routeId = typeof candidate.routeId === 'string'
    ? candidate.routeId.trim()
    : typeof candidate.route === 'string'
      ? candidate.route.trim()
      : '';
  const targetStopId = typeof candidate.targetStopId === 'string'
    ? candidate.targetStopId.trim()
    : typeof candidate.stopId === 'string'
      ? candidate.stopId.trim()
      : '';
  const direction = candidate.direction;
  const targetStopIndex = candidate.targetStopIndex;
  const threshold = candidate.threshold;
  if (!id || !routeId || (direction !== 0 && direction !== 1) || !targetStopId
    || typeof targetStopIndex !== 'number' || !Number.isInteger(targetStopIndex) || targetStopIndex < 0
    || typeof threshold !== 'number' || !Number.isInteger(threshold) || threshold < 1 || threshold > 10) {
    return undefined;
  }
  const normalized: ArrivalAlertSummary = { id, routeId, direction, targetStopId, targetStopIndex, threshold };
  if (typeof candidate.createdAt === 'string') {
    normalized.createdAt = candidate.createdAt;
  }
  if (typeof candidate.expiresAt === 'string') {
    normalized.expiresAt = candidate.expiresAt;
  }
  return normalized;
}

function parkingAlertFrom(value: unknown): ParkingAlertSummary | undefined {
  const candidate = parseJsonObject(value);
  if (!candidate) return undefined;
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const parkingId = typeof candidate.parkingId === 'string'
    ? candidate.parkingId.trim()
    : typeof candidate.facilityId === 'string'
      ? candidate.facilityId.trim()
      : '';
  const parkingName = typeof candidate.parkingName === 'string'
    ? candidate.parkingName.trim()
    : typeof candidate.name === 'string'
      ? candidate.name.trim()
      : '';
  const threshold = candidate.threshold;
  if (!id || !parkingId || !parkingName || typeof threshold !== 'number'
    || !Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
    return undefined;
  }
  const normalized: ParkingAlertSummary = { id, parkingId, parkingName, threshold };
  if (typeof candidate.createdAt === 'string') normalized.createdAt = candidate.createdAt;
  if (typeof candidate.expiresAt === 'string') normalized.expiresAt = candidate.expiresAt;
  return normalized;
}

function decodeVapidKey(value: string): ArrayBuffer {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!normalized) {
    throw new PushClientError('invalid-response');
  }
  const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`;
  try {
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  } catch {
    throw new PushClientError('invalid-response');
  }
}

function subscriptionJson(subscription: PushSubscription): PushSubscriptionJSON {
  const value = subscription.toJSON();
  if (!value.endpoint && subscription.endpoint) {
    return { ...value, endpoint: subscription.endpoint };
  }
  return value;
}

function platformState(options: PushClientOptions): { iosOrIpadOS: boolean; standalone: boolean } {
  const navigatorValue = globalThis.navigator;
  const provided = options.platform;
  const userAgent = provided?.userAgent ?? navigatorValue?.userAgent ?? '';
  const platform = provided?.platform ?? navigatorValue?.platform ?? '';
  const maxTouchPoints = provided?.maxTouchPoints ?? navigatorValue?.maxTouchPoints ?? 0;
  const iosOrIpadOS = /iPhone|iPad|iPod/i.test(userAgent)
    || (platform === 'MacIntel' && maxTouchPoints > 1);
  const nativeStandalone = (navigatorValue as (Navigator & { standalone?: boolean }) | undefined)?.standalone === true;
  const displayModeStandalone = typeof globalThis.matchMedia === 'function'
    && globalThis.matchMedia('(display-mode: standalone)').matches;
  return {
    iosOrIpadOS,
    standalone: provided?.standalone === true
      || provided?.displayModeStandalone === true
      || (provided === undefined && (nativeStandalone || displayModeStandalone)),
  };
}

export function createPushClient(options: PushClientOptions = {}): PushClient {
  const fetcher = options.fetch ?? globalThis.fetch;
  const storage = options.storage ?? defaultStorage();
  const base = apiPrefix(options.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '');
  let inMemoryIdentity: PushIdentity | undefined;

  const readIdentity = (): PushIdentity | undefined => {
    if (inMemoryIdentity) {
      return inMemoryIdentity;
    }
    if (!storage) {
      return undefined;
    }
    let raw: string | null;
    try {
      raw = storage.getItem(PUSH_IDENTITY_STORAGE_KEY);
    } catch {
      return undefined;
    }
    if (raw === null) {
      return undefined;
    }
    try {
      const parsed = identityFrom(JSON.parse(raw) as unknown);
      if (parsed) {
        inMemoryIdentity = parsed;
        return parsed;
      }
    } catch {
      // Fall through to remove a malformed value and start cleanly.
    }
    try {
      storage.removeItem(PUSH_IDENTITY_STORAGE_KEY);
    } catch {
      // A read-only storage should not stop push support checks.
    }
    return undefined;
  };

  const writeIdentity = (identity: PushIdentity): void => {
    inMemoryIdentity = identity;
    if (!storage) {
      return;
    }
    try {
      storage.setItem(PUSH_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
    } catch {
      // Keep the identity in memory when private-mode storage is unavailable.
    }
  };

  const clearIdentity = (): void => {
    inMemoryIdentity = undefined;
    if (!storage) {
      return;
    }
    try {
      storage.removeItem(PUSH_IDENTITY_STORAGE_KEY);
    } catch {
      // A read-only storage should not prevent the next explicit action from retrying.
    }
  };

  const requestJson = async (path: string, init: RequestInit): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetcher(`${base}${path}`, init);
    } catch {
      throw new PushClientError('network');
    }
    if (!response.ok) {
      throw new PushClientError('http', { status: response.status });
    }
    if (response.status === 204) {
      return undefined;
    }
    try {
      return await response.json() as unknown;
    } catch {
      throw new PushClientError('invalid-response');
    }
  };

  let registrationPromise: Promise<ServiceWorkerRegistration> | undefined;
  let publicKeyPromise: Promise<ArrayBuffer> | undefined;

  const loadRegistration = async (): Promise<ServiceWorkerRegistration> => {
    if (options.serviceWorkerRegistration) {
      return options.serviceWorkerRegistration;
    }
    if (options.getServiceWorkerRegistration) {
      return options.getServiceWorkerRegistration();
    }
    const serviceWorker = serviceWorkerApi(options);
    if (!serviceWorker) {
      throw new PushClientError('unsupported');
    }
    try {
      return await serviceWorker.ready;
    } catch {
      throw new PushClientError('unsupported');
    }
  };

  const getRegistration = (): Promise<ServiceWorkerRegistration> => {
    if (!registrationPromise) {
      registrationPromise = loadRegistration().catch((error: unknown) => {
        registrationPromise = undefined;
        throw error;
      });
    }
    return registrationPromise;
  };

  const loadPublicKey = async (): Promise<ArrayBuffer> => {
    const publicKeyPayload = parseJsonObject(await requestJson('/push/public-key', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }));
    const publicKey = typeof publicKeyPayload?.publicKey === 'string'
      ? publicKeyPayload.publicKey
      : typeof publicKeyPayload?.vapidPublicKey === 'string'
        ? publicKeyPayload.vapidPublicKey
        : '';
    if (!publicKey) {
      throw new PushClientError('invalid-response');
    }
    return decodeVapidKey(publicKey);
  };

  const getPublicKey = (): Promise<ArrayBuffer> => {
    if (!publicKeyPromise) {
      publicKeyPromise = loadPublicKey().catch((error: unknown) => {
        publicKeyPromise = undefined;
        throw error;
      });
    }
    return publicKeyPromise;
  };

  const ensureIdentity = async (): Promise<PushIdentity> => {
    const existing = readIdentity();
    if (existing) {
      return existing;
    }
    const [applicationServerKey, workerRegistration] = await Promise.all([getPublicKey(), getRegistration()]);
    const pushManager = options.pushManager ?? workerRegistration.pushManager;
    if (!pushManager) {
      throw new PushClientError('unsupported');
    }
    let subscription: PushSubscription;
    try {
      subscription = await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    } catch {
      throw new PushClientError('unsupported');
    }
    const subscriptionPayload = await requestJson('/push/subscriptions', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(subscriptionJson(subscription)),
    });
    const identity = identityFrom(subscriptionPayload);
    if (!identity) {
      throw new PushClientError('invalid-response');
    }
    writeIdentity(identity);
    return identity;
  };

  const authorizationHeaders = (identity: PushIdentity): Record<string, string> => ({
    Accept: 'application/json',
    Authorization: `Bearer ${identity.alertToken}`,
    'X-Subscription-Id': identity.subscriptionId,
  });

  const authenticatedRequestJson = async (path: string, init: RequestInit): Promise<unknown> => {
    try {
      return await requestJson(path, init);
    } catch (error: unknown) {
      if (error instanceof PushClientError && error.code === 'http' && error.status === 401) {
        clearIdentity();
      }
      throw error;
    }
  };

  const getSupport = (): PushSupport => {
    const notification = notificationApi(options);
    if (!notification) {
      return { supported: false, permission: 'unsupported', reason: 'notification-unavailable' };
    }
    const state = platformState(options);
    if (state.iosOrIpadOS && !state.standalone) {
      return { supported: false, permission: notification.permission, reason: 'ios-not-standalone' };
    }
    if (!hasPushManager(options)) {
      return { supported: false, permission: notification.permission, reason: 'push-unavailable' };
    }
    if (!serviceWorkerApi(options) && !options.serviceWorkerRegistration && !options.getServiceWorkerRegistration) {
      return { supported: false, permission: notification.permission, reason: 'service-worker-unavailable' };
    }
    return { supported: true, permission: notification.permission };
  };

  const prepare = async (): Promise<void> => {
    if (!getSupport().supported) {
      return;
    }
    await Promise.all([getPublicKey(), getRegistration()]);
  };

  return {
    support: getSupport,
    prepare,
    listAlerts: async () => {
      const identity = readIdentity();
      if (!identity) {
        return [];
      }
      const payload = await authenticatedRequestJson('/push/alerts', {
        method: 'GET',
        headers: authorizationHeaders(identity),
      });
      const objectPayload = parseJsonObject(payload);
      const values = Array.isArray(payload) ? payload : objectPayload?.alerts;
      if (!Array.isArray(values)) {
        throw new PushClientError('invalid-response');
      }
      const alerts = values.map(alertFrom);
      if (alerts.some((alert) => alert === undefined)) {
        throw new PushClientError('invalid-response');
      }
      return alerts.filter((alert): alert is ArrivalAlertSummary => alert !== undefined);
    },
    listParkingAlerts: async () => {
      const identity = readIdentity();
      if (!identity) return [];
      const payload = await authenticatedRequestJson('/push/parking-alerts', {
        method: 'GET',
        headers: authorizationHeaders(identity),
      });
      const objectPayload = parseJsonObject(payload);
      const values = Array.isArray(payload) ? payload : objectPayload?.alerts;
      if (!Array.isArray(values)) throw new PushClientError('invalid-response');
      const alerts = values.map(parkingAlertFrom);
      if (alerts.some((alert) => alert === undefined)) throw new PushClientError('invalid-response');
      return alerts.filter((alert): alert is ParkingAlertSummary => alert !== undefined);
    },
    createAlert: async (input) => {
      const values = alertInputValues(input);
      const support = getSupport();
      if (!support.supported) {
        throw new PushClientError('unsupported');
      }
      const notification = notificationApi(options);
      if (!notification) {
        throw new PushClientError('unsupported');
      }
      if (notification.permission === 'denied') {
        throw new PushClientError('permission-denied');
      }
      if (notification.permission === 'default') {
        let permission: NotificationPermission;
        try {
          permission = await notification.requestPermission();
        } catch {
          throw new PushClientError('permission-denied');
        }
        if (permission !== 'granted') {
          throw new PushClientError('permission-denied');
        }
      }
      const identity = await ensureIdentity();
      const payload = await authenticatedRequestJson('/push/alerts', {
        method: 'POST',
        headers: { ...authorizationHeaders(identity), 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const objectPayload = parseJsonObject(payload);
      const alert = alertFrom(objectPayload?.alert ?? payload);
      if (!alert) {
        throw new PushClientError('invalid-response');
      }
      return alert;
    },
    createParkingAlert: async (input) => {
      const values = parkingAlertInputValues(input);
      const support = getSupport();
      if (!support.supported) throw new PushClientError('unsupported');
      const notification = notificationApi(options);
      if (!notification) throw new PushClientError('unsupported');
      if (notification.permission === 'denied') throw new PushClientError('permission-denied');
      if (notification.permission === 'default') {
        let permission: NotificationPermission;
        try {
          permission = await notification.requestPermission();
        } catch {
          throw new PushClientError('permission-denied');
        }
        if (permission !== 'granted') throw new PushClientError('permission-denied');
      }
      const identity = await ensureIdentity();
      const payload = await authenticatedRequestJson('/push/parking-alerts', {
        method: 'POST',
        headers: { ...authorizationHeaders(identity), 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const objectPayload = parseJsonObject(payload);
      const alert = parkingAlertFrom(objectPayload?.alert ?? payload);
      if (!alert) throw new PushClientError('invalid-response');
      return alert;
    },
    deleteAlert: async (id) => {
      const normalizedId = id.trim();
      if (!normalizedId) {
        throw new PushClientError('invalid-request');
      }
      const identity = readIdentity();
      if (!identity) {
        return;
      }
      await authenticatedRequestJson(`/push/alerts/${encodeURIComponent(normalizedId)}`, {
        method: 'DELETE',
        headers: authorizationHeaders(identity),
      });
    },
    deleteParkingAlert: async (id) => {
      const normalizedId = id.trim();
      if (!normalizedId) throw new PushClientError('invalid-request');
      const identity = readIdentity();
      if (!identity) return;
      await authenticatedRequestJson(`/push/parking-alerts/${encodeURIComponent(normalizedId)}`, {
        method: 'DELETE',
        headers: authorizationHeaders(identity),
      });
    },
  };
}
