import { z } from 'zod';

export const DirectionIdSchema = z.union([z.literal(0), z.literal(1)]);
export type DirectionId = z.infer<typeof DirectionIdSchema>;

/** Coordinates are stored as the upstream [longitude, latitude] pair. */
export const CoordinatesSchema = z
  .tuple([
    z.number().finite().min(-180, 'coordinate longitude is out of range').max(180, 'coordinate longitude is out of range'),
    z.number().finite().min(-90, 'coordinate latitude is out of range').max(90, 'coordinate latitude is out of range'),
  ])
  .describe('longitude, latitude');
export type Coordinates = z.infer<typeof CoordinatesSchema>;

export const BusStopSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  nameCn: z.string().trim().min(1),
  nameEn: z.string().trim().min(1).optional(),
  namePor: z.string().trim().min(1).optional(),
  coordinates: CoordinatesSchema,
  routeIds: z.array(z.string().trim().min(1)),
});
export type BusStop = z.infer<typeof BusStopSchema>;

export const RouteDirectionSchema = z.object({
  id: DirectionIdSchema,
  name: z.string().trim().min(1),
  stopIds: z.array(z.string().trim().min(1)).min(1),
});
export type RouteDirection = z.infer<typeof RouteDirectionSchema>;

export const RouteSummarySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  operator: z.string(),
  directions: z.array(RouteDirectionSchema).min(1),
});
export type RouteSummary = z.infer<typeof RouteSummarySchema>;

export const RealtimeBusSchema = z.object({
  plate: z.string(),
  stationCode: z.string(),
  speedKph: z.number().finite().nonnegative().nullable(),
  status: z.string().nullable(),
  passengerFlow: z.string().nullable(),
  busType: z.string().nullable(),
  facilities: z.string().nullable(),
});
export type RealtimeBus = z.infer<typeof RealtimeBusSchema>;

export const RealtimeRouteResponseSchema = z.object({
  route: z.string().trim().min(1),
  direction: DirectionIdSchema,
  updatedAt: z.string().datetime({ offset: true }),
  ageSeconds: z.number().int().nonnegative(),
  stale: z.boolean(),
  source: z.literal('DSAT observation'),
  buses: z.array(RealtimeBusSchema),
});
export type RealtimeRouteResponse = z.infer<typeof RealtimeRouteResponseSchema>;

export const SegmentTimeSchema = z.object({
  route: z.string().trim().min(1),
  direction: DirectionIdSchema,
  fromStopId: z.string().trim().min(1),
  toStopId: z.string().trim().min(1),
  averageSeconds: z.number().finite().nonnegative().optional(),
  // A negative median is retained as an invalid-data signal. ETA must report
  // the segment as unavailable instead of silently falling back to average.
  medianSeconds: z.number().finite().optional(),
  p90Seconds: z.number().finite().nonnegative().optional(),
  samples: z.number().int().nonnegative().optional(),
  timeBucket: z.string().trim().min(1).optional(),
});
export type SegmentTime = z.infer<typeof SegmentTimeSchema>;

export const ProvenanceFileSchema = z.object({
  name: z.string().trim().min(1),
  url: z.string().url(),
  ref: z.string().trim().min(1),
  syncedAt: z.string().datetime({ offset: true }),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'provenance sha256 must be lowercase hexadecimal'),
});
export type ProvenanceFile = z.infer<typeof ProvenanceFileSchema>;

export const CatalogProvenanceSchema = z.object({
  sourceRepository: z.string().url(),
  sourceRef: z.string().trim().min(1),
  syncedAt: z.string().datetime({ offset: true }),
  files: z.array(ProvenanceFileSchema).min(1, 'provenance must list upstream files'),
});
export type CatalogProvenance = z.infer<typeof CatalogProvenanceSchema>;

export const TransitCatalogSchema = z
  .object({
    version: z.number().int().positive(),
    generatedAt: z.string().datetime({ offset: true }),
    provenance: CatalogProvenanceSchema,
    routes: z.array(RouteSummarySchema).min(1),
    stops: z.array(BusStopSchema),
    segmentTimes: z.array(SegmentTimeSchema),
  })
  .superRefine((catalog, context) => {
    const knownStops = new Set(catalog.stops.map((stop) => stop.id));
    const routeIds = new Set(catalog.routes.map((route) => route.id));

    for (const route of catalog.routes) {
      for (const direction of route.directions) {
        for (const stopId of direction.stopIds) {
          if (!knownStops.has(stopId)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['routes', route.id, 'directions', direction.id, 'stopIds'],
              message: `unknown stop id ${stopId}`,
            });
          }
        }
      }
    }

    for (const [index, segment] of catalog.segmentTimes.entries()) {
      if (!routeIds.has(segment.route)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['segmentTimes', index, 'route'],
          message: `unknown route id ${segment.route}`,
        });
      }
      if (!knownStops.has(segment.fromStopId) || !knownStops.has(segment.toStopId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['segmentTimes', index],
          message: 'segment time references an unknown coordinate-bearing stop',
        });
      }
    }
  });
export type TransitCatalog = z.infer<typeof TransitCatalogSchema>;

export function parseTransitCatalog(value: unknown): TransitCatalog {
  return TransitCatalogSchema.parse(value);
}
