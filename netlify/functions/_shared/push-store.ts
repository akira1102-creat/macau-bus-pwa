import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { getStore, type Store } from '@netlify/blobs';

import {
  REALTIME_RATE_LIMIT_MAX_REQUESTS,
  REALTIME_RATE_LIMIT_MAX_TRACKED_KEYS,
  REALTIME_RATE_LIMIT_WINDOW_MS,
} from '../../../server/config';
import { RealtimeRateLimiter } from '../../../server/routes/realtime';
import type { CatalogRepository } from '../../../src/data/catalog-repository';
import {
  PushReservationSchema,
  StoredParkingAlertSchema,
  StoredAlertSchema,
  type StoredParkingAlert,
  type DeadSubscriptionCleanup,
  StoredSubscriptionSchema,
  type PushReservation,
  type StoredAlert,
  type StoredSubscription,
} from './push-contract';

export type {
  ArrivalAlertInput,
  ArrivalAlertSummary,
  ParkingAlertInput,
  ParkingAlertSummary,
  PushIdentity,
  PushReservation,
  PushSubscriptionInput,
  DeadSubscriptionCleanup,
  StoredAlert,
  StoredSubscription,
  StoredParkingAlert,
} from './push-contract';

export interface JsonBlobStore<T extends { id: string }> {
  get(key: string): Promise<T | undefined>;
  getWithMetadata(key: string): Promise<{ value: T; etag?: string } | undefined>;
  set(key: string, value: T): Promise<void>;
  setIfNew(key: string, value: T): Promise<boolean>;
  setIfMatch(key: string, value: T, etag: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

class NetlifyJsonBlobStore<T extends { id: string }> implements JsonBlobStore<T> {
  constructor(private readonly store: Store) {}

  async get(key: string): Promise<T | undefined> {
    const value: unknown = await this.store.get(key, { type: 'json' });
    return value === null || value === undefined ? undefined : value as T;
  }

  async getWithMetadata(key: string): Promise<{ value: T; etag?: string } | undefined> {
    const value = await this.store.getWithMetadata(key, { type: 'json' });
    if (value === null) return undefined;
    return value.etag === undefined
      ? { value: value.data as T }
      : { value: value.data as T, etag: value.etag };
  }

  async set(key: string, value: T): Promise<void> {
    await this.store.setJSON(key, value);
  }

  async setIfNew(key: string, value: T): Promise<boolean> {
    const result = await this.store.setJSON(key, value, { onlyIfNew: true });
    return result.modified;
  }

  async setIfMatch(key: string, value: T, etag: string): Promise<boolean> {
    const result = await this.store.setJSON(key, value, { onlyIfMatch: etag });
    return result.modified;
  }

  async delete(key: string): Promise<void> {
    await this.store.delete(key);
  }

  async list(prefix?: string): Promise<string[]> {
    const result = prefix === undefined
      ? await this.store.list()
      : await this.store.list({ prefix });
    return result.blobs.map((blob) => blob.key);
  }
}

export interface PushStores {
  subscriptions: JsonBlobStore<StoredSubscription>;
  alerts: JsonBlobStore<StoredAlert>;
  reservations: JsonBlobStore<PushReservation>;
  /** Separate namespace for one-shot parking alerts; bus alert storage stays untouched. */
  parkingAlerts?: JsonBlobStore<StoredParkingAlert>;
  parkingReservations?: JsonBlobStore<PushReservation>;
  /** Separate retry queue for provider-invalid subscriptions. */
  deadSubscriptionCleanup?: JsonBlobStore<DeadSubscriptionCleanup>;
}

export interface PushApiDependencies {
  stores: PushStores;
  catalog?: CatalogRepository;
  getCatalog?: () => Promise<CatalogRepository | undefined>;
  now?: () => Date;
  randomBytes?: (size: number) => Buffer;
  publicKey?: string;
  rateLimiter?: RealtimeRateLimiter;
  globalSubscriptionLimit?: number;
  staleSubscriptionMs?: number;
  maxStaleCleanup?: number;
}

let defaultStores: PushStores | undefined;
let defaultRateLimiter: RealtimeRateLimiter | undefined;

export const PUSH_RATE_LIMIT_WINDOW_MS = REALTIME_RATE_LIMIT_WINDOW_MS;
export const PUSH_RATE_LIMIT_MAX_REQUESTS = REALTIME_RATE_LIMIT_MAX_REQUESTS;
export const PUSH_RATE_LIMIT_MAX_TRACKED_KEYS = REALTIME_RATE_LIMIT_MAX_TRACKED_KEYS;
export const DEFAULT_GLOBAL_SUBSCRIPTION_LIMIT = 10_000;
export const DEFAULT_STALE_SUBSCRIPTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const DEFAULT_MAX_STALE_CLEANUP = 100;
export const MAX_LEGACY_SUBSCRIPTION_SCAN = 100;
export const GLOBAL_SUBSCRIPTION_ADMISSION_KEY = '__global-subscription-admission__';
export const GLOBAL_SUBSCRIPTION_ADMISSION_TTL_MS = 5 * 60 * 1_000;
export const PUSH_MUTATION_RESERVATION_TTL_MS = 15_000;

export interface PushReservationLease {
  owner: string;
  etag: string;
}

export function alertStoragePrefix(subscriptionId: string): string {
  return `${subscriptionId}/`;
}

export function alertStorageKey(subscriptionId: string, alertId: string): string {
  return `${alertStoragePrefix(subscriptionId)}${alertId}`;
}

export function parkingAlertStoragePrefix(subscriptionId: string): string {
  return `${subscriptionId}/`;
}

export function parkingAlertStorageKey(subscriptionId: string, alertId: string): string {
  return `${parkingAlertStoragePrefix(subscriptionId)}${alertId}`;
}

/** Resolve the independently named parking-alert blob store and fail closed if wiring is incomplete. */
export function parkingAlertsStore(stores: PushStores): JsonBlobStore<StoredParkingAlert> {
  if (!stores.parkingAlerts) {
    throw new Error('parking-alert-store-unavailable');
  }
  return stores.parkingAlerts;
}

export function parkingReservationsStore(stores: PushStores): JsonBlobStore<PushReservation> {
  if (!stores.parkingReservations) {
    throw new Error('parking-reservation-store-unavailable');
  }
  return stores.parkingReservations;
}

export function deadSubscriptionCleanupStore(stores: PushStores): JsonBlobStore<DeadSubscriptionCleanup> | undefined {
  return stores.deadSubscriptionCleanup;
}

export function deadSubscriptionCleanupKey(subscriptionId: string): string {
  return subscriptionId;
}

export async function acquirePushMutationReservation(
  store: JsonBlobStore<PushReservation>,
  subscriptionId: string,
  now: Date,
  randomizer: (size: number) => Buffer = randomBytes,
): Promise<PushReservationLease | undefined> {
  const owner = makeRandomId(randomizer);
  const next: PushReservation = {
    id: subscriptionId,
    subscriptionId,
    owner,
    expiresAt: new Date(now.getTime() + PUSH_MUTATION_RESERVATION_TTL_MS).toISOString(),
  };
  const existing = await store.getWithMetadata(subscriptionId);
  if (existing === undefined) {
    if (!await store.setIfNew(subscriptionId, next)) return undefined;
  } else {
    const parsed = PushReservationSchema.safeParse(existing.value);
    const expiresAt = parsed.success ? Date.parse(parsed.data.expiresAt) : Number.NaN;
    if (Number.isFinite(expiresAt) && expiresAt > now.getTime()) return undefined;
    if (!existing.etag || !await store.setIfMatch(subscriptionId, next, existing.etag)) return undefined;
  }
  const stored = await store.getWithMetadata(subscriptionId);
  const parsed = stored === undefined ? undefined : PushReservationSchema.safeParse(stored.value);
  return stored?.etag && parsed?.success && parsed.data.owner === owner
    ? { owner, etag: stored.etag }
    : undefined;
}

export async function releasePushMutationReservation(
  store: JsonBlobStore<PushReservation>,
  subscriptionId: string,
  lease: PushReservationLease,
  now: Date,
): Promise<void> {
  const current = await store.getWithMetadata(subscriptionId);
  if (!current?.etag) return;
  const parsed = PushReservationSchema.safeParse(current.value);
  if (!parsed.success || parsed.data.owner !== lease.owner) return;
  await store.setIfMatch(subscriptionId, {
    ...parsed.data,
    expiresAt: new Date(now.getTime() - 1).toISOString(),
  }, current.etag);
}

export function getPushRateLimiter(): RealtimeRateLimiter {
  if (!defaultRateLimiter) {
    defaultRateLimiter = new RealtimeRateLimiter({
      windowMs: PUSH_RATE_LIMIT_WINDOW_MS,
      maxRequests: PUSH_RATE_LIMIT_MAX_REQUESTS,
      maxTrackedKeys: PUSH_RATE_LIMIT_MAX_TRACKED_KEYS,
    });
  }
  return defaultRateLimiter;
}

export function resetPushRateLimiterForTests(): void {
  defaultRateLimiter = undefined;
}

export function getPushStores(): PushStores {
  if (!defaultStores) {
    defaultStores = {
      subscriptions: new NetlifyJsonBlobStore<StoredSubscription>(getStore({
        name: 'push-subscriptions',
        consistency: 'strong',
      })),
      alerts: new NetlifyJsonBlobStore<StoredAlert>(getStore({
        name: 'arrival-alerts',
        consistency: 'strong',
      })),
      reservations: new NetlifyJsonBlobStore<PushReservation>(getStore({
        name: 'arrival-alert-reservations',
        consistency: 'strong',
      })),
      parkingAlerts: new NetlifyJsonBlobStore<StoredParkingAlert>(getStore({
        name: 'parking-alerts',
        consistency: 'strong',
      })),
      parkingReservations: new NetlifyJsonBlobStore<PushReservation>(getStore({
        name: 'parking-alert-reservations',
        consistency: 'strong',
      })),
      deadSubscriptionCleanup: new NetlifyJsonBlobStore<DeadSubscriptionCleanup>(getStore({
        name: 'dead-subscription-cleanup',
        consistency: 'strong',
      })),
    };
  }
  return defaultStores;
}

export function resetPushStoresForTests(): void {
  defaultStores = undefined;
}

export function getDefaultPushDependencies(): PushApiDependencies {
  return {
    stores: getPushStores(),
    rateLimiter: getPushRateLimiter(),
  };
}

export async function acquireGlobalSubscriptionAdmission(
  stores: PushStores,
  now: Date,
  randomizer: (size: number) => Buffer = randomBytes,
): Promise<PushReservationLease | undefined> {
  const owner = makeRandomId(randomizer);
  const next: PushReservation = {
    id: GLOBAL_SUBSCRIPTION_ADMISSION_KEY,
    subscriptionId: GLOBAL_SUBSCRIPTION_ADMISSION_KEY,
    owner,
    expiresAt: new Date(now.getTime() + GLOBAL_SUBSCRIPTION_ADMISSION_TTL_MS).toISOString(),
  };
  const existing = await stores.reservations.getWithMetadata(GLOBAL_SUBSCRIPTION_ADMISSION_KEY);
  if (existing === undefined) {
    if (!await stores.reservations.setIfNew(GLOBAL_SUBSCRIPTION_ADMISSION_KEY, next)) return undefined;
  } else {
    const parsed = PushReservationSchema.safeParse(existing.value);
    const expiresAt = parsed.success ? Date.parse(parsed.data.expiresAt) : Number.NaN;
    if (Number.isFinite(expiresAt) && expiresAt > now.getTime()) return undefined;
    if (!existing.etag || !await stores.reservations.setIfMatch(
      GLOBAL_SUBSCRIPTION_ADMISSION_KEY,
      next,
      existing.etag,
    )) {
      return undefined;
    }
  }
  const stored = await stores.reservations.getWithMetadata(GLOBAL_SUBSCRIPTION_ADMISSION_KEY);
  const parsed = stored === undefined ? undefined : PushReservationSchema.safeParse(stored.value);
  return stored?.etag && parsed?.success && parsed.data.owner === owner
    ? { owner, etag: stored.etag }
    : undefined;
}

export async function renewGlobalSubscriptionAdmission(
  stores: PushStores,
  lease: PushReservationLease,
  now: Date,
): Promise<PushReservationLease | undefined> {
  const current = await stores.reservations.getWithMetadata(GLOBAL_SUBSCRIPTION_ADMISSION_KEY);
  if (!current?.etag || current.etag !== lease.etag) return undefined;
  const parsed = PushReservationSchema.safeParse(current.value);
  if (!parsed.success || parsed.data.owner !== lease.owner) return undefined;
  const expiresAt = Date.parse(parsed.data.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return undefined;
  const renewed = {
    ...parsed.data,
    expiresAt: new Date(now.getTime() + GLOBAL_SUBSCRIPTION_ADMISSION_TTL_MS).toISOString(),
  } satisfies PushReservation;
  if (!await stores.reservations.setIfMatch(
    GLOBAL_SUBSCRIPTION_ADMISSION_KEY,
    renewed,
    current.etag,
  )) {
    return undefined;
  }
  const stored = await stores.reservations.getWithMetadata(GLOBAL_SUBSCRIPTION_ADMISSION_KEY);
  const storedParsed = stored === undefined ? undefined : PushReservationSchema.safeParse(stored.value);
  return stored?.etag && storedParsed?.success && storedParsed.data.owner === lease.owner
    ? { owner: lease.owner, etag: stored.etag }
    : undefined;
}

export async function releaseGlobalSubscriptionAdmission(
  stores: PushStores,
  lease: PushReservationLease,
  now: Date,
): Promise<void> {
  const current = await stores.reservations.getWithMetadata(GLOBAL_SUBSCRIPTION_ADMISSION_KEY);
  if (!current?.etag) return;
  const parsed = PushReservationSchema.safeParse(current.value);
  if (!parsed.success || parsed.data.owner !== lease.owner) return;
  await stores.reservations.setIfMatch(GLOBAL_SUBSCRIPTION_ADMISSION_KEY, {
    ...parsed.data,
    expiresAt: new Date(now.getTime() - 1).toISOString(),
  }, current.etag);
}

export interface StaleSubscriptionCleanupOptions {
  staleAfterMs?: number;
  maxRecords?: number;
}

export async function cleanupStaleSubscriptions(
  stores: PushStores,
  now: Date,
  options: StaleSubscriptionCleanupOptions = {},
): Promise<number> {
  const staleAfterMs = Number.isFinite(options.staleAfterMs) && (options.staleAfterMs ?? 0) > 0
    ? options.staleAfterMs as number
    : DEFAULT_STALE_SUBSCRIPTION_MS;
  const maxRecords = Number.isInteger(options.maxRecords) && (options.maxRecords ?? 0) > 0
    ? Math.min(options.maxRecords as number, DEFAULT_MAX_STALE_CLEANUP)
    : DEFAULT_MAX_STALE_CLEANUP;
  const activeSubscriptionIds = new Set<string>();
  const nowMilliseconds = now.getTime();
  for (const key of await stores.alerts.list()) {
    const value = await stores.alerts.get(key);
    const parsed = value === undefined ? undefined : StoredAlertSchema.safeParse(value);
    if (parsed?.success && Date.parse(parsed.data.expiresAt) > nowMilliseconds) {
      activeSubscriptionIds.add(parsed.data.subscriptionId);
    }
  }
  if (stores.parkingAlerts) {
    for (const key of await stores.parkingAlerts.list()) {
      const value = await stores.parkingAlerts.get(key);
      const parsed = value === undefined ? undefined : StoredParkingAlertSchema.safeParse(value);
      if (parsed?.success && Date.parse(parsed.data.expiresAt) > nowMilliseconds) {
        activeSubscriptionIds.add(parsed.data.subscriptionId);
      }
    }
  }

  let deleted = 0;
  const keys = (await stores.subscriptions.list()).slice(0, maxRecords);
  const staleBefore = nowMilliseconds - staleAfterMs;
  for (const key of keys) {
    const value = await stores.subscriptions.get(key);
    const parsed = value === undefined ? undefined : StoredSubscriptionSchema.safeParse(value);
    if (!parsed?.success) continue;
    const updatedAt = Date.parse(parsed.data.updatedAt);
    if (Number.isFinite(updatedAt) && updatedAt <= staleBefore && !activeSubscriptionIds.has(parsed.data.id)) {
      await stores.subscriptions.delete(key);
      await stores.reservations.delete(parsed.data.id);
      deleted += 1;
    }
  }
  return deleted;
}

export function capabilityTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export const hashCapabilityToken = capabilityTokenHash;

export function makeRandomId(randomizer: (size: number) => Buffer = randomBytes): string {
  return randomizer(16).toString('hex');
}

export function makeCapabilityToken(randomizer: (size: number) => Buffer = randomBytes): string {
  return randomizer(32).toString('base64url');
}

export function currentTime(dependencies: Pick<PushApiDependencies, 'now'>): Date {
  return dependencies.now?.() ?? new Date();
}

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization')?.trim() ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return undefined;
  const token = authorization.slice('bearer '.length).trim();
  return token || undefined;
}

function equalHash(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/** Resolve the anonymous subscription represented by the bearer capability. */
export async function authenticateSubscription(
  request: Request,
  stores: PushStores,
): Promise<StoredSubscription | undefined> {
  const token = bearerToken(request);
  if (!token) return undefined;
  const tokenHash = capabilityTokenHash(token);
  const requestedId = (
    request.headers.get('x-subscription-id')
    ?? request.headers.get('x-push-subscription-id')
  )?.trim();
  if (requestedId) {
    const subscription = await stores.subscriptions.get(requestedId);
    return subscription && equalHash(subscription.tokenHash, tokenHash) ? subscription : undefined;
  }

  const legacyKeys = (await stores.subscriptions.list()).slice(0, MAX_LEGACY_SUBSCRIPTION_SCAN);
  for (const key of legacyKeys) {
    const subscription = await stores.subscriptions.get(key);
    if (subscription && equalHash(subscription.tokenHash, tokenHash)) {
      return subscription;
    }
  }
  return undefined;
}

export async function deleteSubscriptionAndAlerts(
  subscriptionId: string,
  stores: PushStores,
): Promise<void> {
  for (const key of await stores.alerts.list(alertStoragePrefix(subscriptionId))) {
    const alert = await stores.alerts.get(key);
    if (alert?.subscriptionId === subscriptionId) {
      await stores.alerts.delete(key);
    }
  }
  const parkingStore = stores.parkingAlerts;
  if (parkingStore) {
    for (const key of await parkingStore.list(parkingAlertStoragePrefix(subscriptionId))) {
      const alert = await parkingStore.get(key);
      const parsed = alert === undefined ? undefined : StoredParkingAlertSchema.safeParse(alert);
      if (parsed?.success && parsed.data.subscriptionId === subscriptionId) {
        await parkingStore.delete(key);
      }
    }
  }
  await stores.reservations.delete(subscriptionId);
  if (stores.parkingReservations) {
    await stores.parkingReservations.delete(subscriptionId);
  }
  // Delete the identity last so a partial cleanup can be retried by the checker.
  await stores.subscriptions.delete(subscriptionId);
}
