/**
 * Dev/e2e demo user (SPEC Phase 2): home at Main St & Preston Rd, Frisco; Costco member, no Sam's;
 * Tom Thumb + Kroger loyalty cards on; Kroger as the usual (baseline) store; already onboarded.
 */
import { hash } from '@node-rs/argon2';
import { ARGON2_OPTIONS, DEFAULT_ORIGIN, preselectChains } from '@sgs/core';
import { storeLocations, stores, users, userStores, type Db } from '@sgs/db';

export const DEMO_EMAIL = 'demo@sgs.test';
export const DEFAULT_DEMO_PASSWORD = 'demo-password-123';

export async function seedDemoUser(
  db: Db,
  password: string,
  now: Date,
): Promise<{ id: string; email: string }> {
  const allStores = await db.select().from(stores);
  const locs = await db.select().from(storeLocations);
  const kroger = allStores.find((s) => s.slug === 'kroger');
  const [user] = await db
    .insert(users)
    .values({
      email: DEMO_EMAIL,
      passwordHash: await hash(password, ARGON2_OPTIONS),
      displayName: 'Demo Family',
      homeZip: '75034',
      homeLat: DEFAULT_ORIGIN.lat,
      homeLng: DEFAULT_ORIGIN.lng,
      vehicleMpg: 25,
      baselineStoreId: kroger?.id ?? null,
      onboardedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: users.id, email: users.email });
  if (!user) throw new Error('demo user insert failed');
  const pre = preselectChains(
    DEFAULT_ORIGIN,
    allStores.map((s) => ({ storeId: s.id, locations: locs.filter((l) => l.storeId === s.id) })),
  );
  await db.insert(userStores).values(
    allStores.map((s) => ({
      userId: user.id,
      storeId: s.id,
      enabled: pre.chains.find((c) => c.storeId === s.id)?.preselected ?? false,
      hasMembership: s.slug === 'costco',
      hasLoyalty: s.loyaltyProgram !== null,
      preferredLocationId: null,
    })),
  );
  return user;
}
