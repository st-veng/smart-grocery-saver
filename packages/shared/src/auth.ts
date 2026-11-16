import { z } from 'zod';

// Kept in sync with @sgs/core auth-params (shared must stay dependency-free for the web bundle).
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

const Email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address' }).max(254));

export const RegisterRequest = z.object({
  email: Email,
  password: z
    .string()
    .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
    .max(PASSWORD_MAX),
  displayName: z.string().trim().min(1, 'Enter your name').max(80),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const LoginRequest = z.object({
  email: Email,
  password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const Theme = z.enum(['system', 'light', 'dark']);

export const User = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  homeZip: z.string().nullable(),
  home: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  vehicleMpg: z.number(),
  fuelCentsPerGal: z.number().int().nullable(),
  baselineStoreId: z.number().int().nullable(),
  theme: Theme,
  onboarded: z.boolean(),
  hasPassword: z.boolean(),
  providers: z.array(z.enum(['google'])),
});
export type User = z.infer<typeof User>;

export const MeResponse = z.object({ user: User });
export type MeResponse = z.infer<typeof MeResponse>;

export const UpdateProfileRequest = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    homeZip: z.string().regex(/^\d{5}$/, 'Enter a 5-digit ZIP code'),
    vehicleMpg: z.number().gt(0).max(150),
    fuelCentsPerGal: z.number().int().positive().max(2000).nullable(),
    baselineStoreId: z.number().int().positive().nullable(),
    theme: Theme,
    completeOnboarding: z.literal(true),
  })
  .partial()
  .strict();
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;

export const Store = z.object({
  id: z.number().int(),
  slug: z.string(),
  name: z.string(),
  brandColor: z.string(),
  requiresMembership: z.boolean(),
  loyaltyProgram: z.string().nullable(),
});
export type Store = z.infer<typeof Store>;

export const StoresResponse = z.object({ stores: z.array(Store) });

export const StoreLocation = z.object({
  id: z.number().int(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  zip: z.string(),
  lat: z.number(),
  lng: z.number(),
  distanceMiles: z.number().nullable(),
});
export const LocationsResponse = z.object({ locations: z.array(StoreLocation) });

export const MyStore = Store.extend({
  enabled: z.boolean(),
  hasMembership: z.boolean(),
  hasLoyalty: z.boolean(),
  preferredLocationId: z.number().int().nullable(),
  nearestLocation: z
    .object({ id: z.number().int(), name: z.string(), distanceMiles: z.number() })
    .nullable(),
  /** Within the pre-selection radius of the user's home (SPEC §2.7). */
  preselected: z.boolean(),
  /** True once the user has saved store settings; until then values are suggestions. */
  saved: z.boolean(),
});
export type MyStore = z.infer<typeof MyStore>;

export const MyStoresResponse = z.object({
  stores: z.array(MyStore),
  radiusMiles: z.number(),
  /** No chain within the radius: the nearest 3 are suggested instead. */
  fallback: z.boolean(),
});
export type MyStoresResponse = z.infer<typeof MyStoresResponse>;

export const PutMyStoresRequest = z.object({
  stores: z
    .array(
      z
        .object({
          storeId: z.number().int().positive(),
          enabled: z.boolean(),
          hasMembership: z.boolean(),
          hasLoyalty: z.boolean(),
          preferredLocationId: z.number().int().positive().nullable(),
        })
        .strict(),
    )
    .min(1)
    .max(50),
});
export type PutMyStoresRequest = z.infer<typeof PutMyStoresRequest>;
