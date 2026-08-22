import { z } from 'zod';

/** A deliberately conservative WGS84 bounding box for Macau facilities. */
export const MACAU_BOUNDS = {
  minLatitude: 22.08,
  maxLatitude: 22.25,
  minLongitude: 113.5,
  maxLongitude: 113.65,
} as const;

export const ParkingSpacesSchema = z.object({
  car: z.number().int().nonnegative().nullable(),
  motorcycle: z.number().int().nonnegative().nullable(),
  electricCar: z.number().int().nonnegative().nullable(),
  electricMotorcycle: z.number().int().nonnegative().nullable(),
  accessible: z.number().int().nonnegative().nullable(),
});
export type ParkingSpaces = z.infer<typeof ParkingSpacesSchema>;

const ParkingLatitudeSchema = z.number()
  .finite()
  .min(MACAU_BOUNDS.minLatitude)
  .max(MACAU_BOUNDS.maxLatitude)
  .nullable();
const ParkingLongitudeSchema = z.number()
  .finite()
  .min(MACAU_BOUNDS.minLongitude)
  .max(MACAU_BOUNDS.maxLongitude)
  .nullable();

export const ParkingFacilitySchema = z.object({
  id: z.string().regex(/^\d+$/, 'parking facility ID must be numeric'),
  name: z.string().trim().min(1),
  location: z.string().trim().min(1).nullable(),
  entrance: z.string().trim().min(1).nullable(),
  latitude: ParkingLatitudeSchema,
  longitude: ParkingLongitudeSchema,
  spaces: ParkingSpacesSchema,
  updatedAt: z.string().datetime({ offset: true }).nullable(),
  suspended: z.boolean(),
}).superRefine((facility, context) => {
  if ((facility.latitude === null) !== (facility.longitude === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['latitude'],
      message: 'latitude and longitude must be provided together',
    });
  }
});
export type ParkingFacility = z.infer<typeof ParkingFacilitySchema>;

export const ParkingSnapshotSchema = z.object({
  updatedAt: z.string().datetime({ offset: true }),
  stale: z.boolean(),
  facilities: z.array(ParkingFacilitySchema),
});
export type ParkingSnapshot = z.infer<typeof ParkingSnapshotSchema>;

// Keep the response name discoverable for consumers that call the endpoint
// response a DTO rather than a snapshot.
export const ParkingResponseSchema = ParkingSnapshotSchema;
export type ParkingResponse = ParkingSnapshot;
