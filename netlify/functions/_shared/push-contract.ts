import { z } from 'zod';

import { DirectionIdSchema } from '../../../shared/transit-contract';

const STANDARD_PUSH_PROVIDERS = [
  { host: 'fcm.googleapis.com', pathPrefixes: ['/fcm/send/', '/wp/'] },
  { host: 'android.googleapis.com', pathPrefixes: ['/gcm/send/'] },
  { host: 'web.push.apple.com', pathPrefixes: ['/3/device/'] },
  { host: 'updates.push.services.mozilla.com', pathPrefixes: ['/wpush/v2/', '/wpush/v3/'] },
] as const;

export function isAllowedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.port
      || url.search
      || url.hash
    ) {
      return false;
    }
    const provider = STANDARD_PUSH_PROVIDERS.find(({ host }) => url.hostname === host);
    return provider?.pathPrefixes.some((prefix) => url.pathname.startsWith(prefix) && url.pathname.length > prefix.length)
      ?? false;
  } catch {
    return false;
  }
}

export const PushIdentitySchema = z.object({
  subscriptionId: z.string().trim().min(1),
  alertToken: z.string().trim().min(1),
});
export type PushIdentity = z.infer<typeof PushIdentitySchema>;

export const PushSubscriptionInputSchema = z.object({
  endpoint: z.string().url().refine(isAllowedPushEndpoint, 'unsupported push provider endpoint'),
  keys: z.object({
    p256dh: z.string().trim().min(1),
    auth: z.string().trim().min(1),
  }),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInputSchema>;

export const ArrivalAlertInputSchema = z.object({
  routeId: z.string().trim().min(1),
  direction: DirectionIdSchema,
  targetStopId: z.string().trim().min(1),
  targetStopIndex: z.number().int().nonnegative(),
  threshold: z.number().int().min(1).max(10),
});
export type ArrivalAlertInput = z.infer<typeof ArrivalAlertInputSchema>;

export const ArrivalAlertSummarySchema = z.object({
  id: z.string().trim().min(1),
  routeId: z.string().trim().min(1),
  direction: DirectionIdSchema,
  targetStopId: z.string().trim().min(1),
  targetStopIndex: z.number().int().nonnegative(),
  threshold: z.number().int().min(1).max(10),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
});
export type ArrivalAlertSummary = z.infer<typeof ArrivalAlertSummarySchema>;

export const ArrivalAlertsResponseSchema = z.object({
  alerts: z.array(ArrivalAlertSummarySchema),
});

export const ParkingAlertInputSchema = z.object({
  parkingId: z.string().trim().min(1).max(64),
  parkingName: z.string().trim().min(1).max(200),
  threshold: z.number().int().min(1).max(100),
});
export type ParkingAlertInput = z.infer<typeof ParkingAlertInputSchema>;

export const ParkingAlertSummarySchema = z.object({
  id: z.string().trim().min(1),
  parkingId: z.string().trim().min(1).max(64),
  parkingName: z.string().trim().min(1).max(200),
  threshold: z.number().int().min(1).max(100),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
});
export type ParkingAlertSummary = z.infer<typeof ParkingAlertSummarySchema>;

export const ParkingAlertsResponseSchema = z.object({
  alerts: z.array(ParkingAlertSummarySchema),
});

export const StoredSubscriptionSchema = z.object({
  id: z.string().trim().min(1),
  endpoint: z.string().url().refine(isAllowedPushEndpoint, 'unsupported push provider endpoint'),
  keys: z.object({
    p256dh: z.string().trim().min(1),
    auth: z.string().trim().min(1),
  }),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type StoredSubscription = z.infer<typeof StoredSubscriptionSchema>;

export const PushReservationSchema = z.object({
  id: z.string().trim().min(1),
  subscriptionId: z.string().trim().min(1),
  owner: z.string().trim().min(1),
  expiresAt: z.string().datetime({ offset: true }),
});
export type PushReservation = z.infer<typeof PushReservationSchema>;

/**
 * A bounded retry record for provider-invalid subscriptions.  Keep this
 * intentionally independent from push capabilities and alert payloads: the
 * checker only needs the subscription identity and when the retry was queued.
 */
export const DeadSubscriptionCleanupSchema = z.object({
  id: z.string().trim().min(1),
  subscriptionId: z.string().trim().min(1),
  createdAt: z.string().datetime({ offset: true }),
});
export type DeadSubscriptionCleanup = z.infer<typeof DeadSubscriptionCleanupSchema>;

export const StoredAlertSchema = ArrivalAlertSummarySchema.extend({
  subscriptionId: z.string().trim().min(1),
  state: z.enum(['pending', 'claimed', 'delivered']).optional(),
  claimId: z.string().trim().min(1).optional(),
  claimExpiresAt: z.string().datetime({ offset: true }).optional(),
  deliveredAt: z.string().datetime({ offset: true }).optional(),
});
export type StoredAlert = z.infer<typeof StoredAlertSchema>;

export const StoredParkingAlertSchema = ParkingAlertSummarySchema.extend({
  subscriptionId: z.string().trim().min(1),
  state: z.enum(['pending', 'claimed', 'delivered']).optional(),
  claimId: z.string().trim().min(1).optional(),
  claimExpiresAt: z.string().datetime({ offset: true }).optional(),
  deliveredAt: z.string().datetime({ offset: true }).optional(),
});
export type StoredParkingAlert = z.infer<typeof StoredParkingAlertSchema>;
