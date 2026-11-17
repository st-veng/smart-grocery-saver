import { haversineMiles, type LatLng } from '@sgs/core';
import { userStoreView } from '@sgs/pricing';
import { storeLocations, stores, userStores, type Db } from '@sgs/db';
import type { MyStoresResponse, PutMyStoresRequest, Store } from '@sgs/shared';
import { asc, eq } from 'drizzle-orm';
import { AppError } from '../errors.js';

export async function listStores(db: Db): Promise<Store[]> {
  return db
    .select({
      id: stores.id,
      slug: stores.slug,
      name: stores.name,
      brandColor: stores.brandColor,
      requiresMembership: stores.requiresMembership,
      loyaltyProgram: stores.loyaltyProgram,
    })
    .from(stores)
    .orderBy(asc(stores.sortOrder));
}

export async function listLocations(db: Db, slug: string, near: LatLng | null) {
  const [store] = await db.select({ id: stores.id }).from(stores).where(eq(stores.slug, slug));
  if (!store) throw new AppError('NOT_FOUND', 404, `Unknown store ${slug}`);
  const rows = await db
    .select({
      id: storeLocations.id,
      name: storeLocations.name,
      address: storeLocations.address,
      city: storeLocations.city,
      zip: storeLocations.zip,
      lat: storeLocations.lat,
      lng: storeLocations.lng,
    })
    .from(storeLocations)
    .where(eq(storeLocations.storeId, store.id));
  const out = rows.map((r) => ({ ...r, distanceMiles: near ? haversineMiles(near, r) : null }));
  out.sort((a, b) => (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0) || a.id - b.id);
  return out;
}

/** The user's per-store settings, with SPEC §2.7 pre-selection as the default until they save. */
export async function myStores(
  db: Db,
  userId: string,
  radiusMiles: number,
): Promise<MyStoresResponse> {
  const view = await userStoreView(db, userId, radiusMiles);
  return {
    ...view,
    stores: view.stores.map(({ sortOrder: _sortOrder, ...rest }) => rest),
  };
}

export async function saveMyStores(
  db: Db,
  userId: string,
  input: PutMyStoresRequest,
): Promise<void> {
  const all = await listStores(db);
  const byId = new Map(all.map((s) => [s.id, s]));
  const locs = await db
    .select({ id: storeLocations.id, storeId: storeLocations.storeId })
    .from(storeLocations);
  const details: { path: (string | number)[]; message: string }[] = [];
  const seen = new Set<number>();
  input.stores.forEach((s, i) => {
    const store = byId.get(s.storeId);
    if (!store) details.push({ path: ['stores', i, 'storeId'], message: 'Unknown store' });
    else {
      if (s.hasMembership && !store.requiresMembership) {
        details.push({
          path: ['stores', i, 'hasMembership'],
          message: `${store.name} has no paid membership`,
        });
      }
      if (s.hasLoyalty && store.loyaltyProgram === null) {
        details.push({
          path: ['stores', i, 'hasLoyalty'],
          message: `${store.name} has no loyalty program`,
        });
      }
      if (
        s.preferredLocationId !== null &&
        !locs.some((l) => l.id === s.preferredLocationId && l.storeId === s.storeId)
      ) {
        details.push({
          path: ['stores', i, 'preferredLocationId'],
          message: 'Location does not belong to this store',
        });
      }
    }
    if (seen.has(s.storeId))
      details.push({ path: ['stores', i, 'storeId'], message: 'Duplicate store' });
    seen.add(s.storeId);
  });
  if (details.length)
    throw new AppError('VALIDATION_FAILED', 422, 'Some store settings are invalid', details);

  await db.transaction(async (tx) => {
    for (const s of input.stores) {
      await tx
        .insert(userStores)
        .values({ userId, ...s })
        .onConflictDoUpdate({
          target: [userStores.userId, userStores.storeId],
          set: {
            enabled: s.enabled,
            hasMembership: s.hasMembership,
            hasLoyalty: s.hasLoyalty,
            preferredLocationId: s.preferredLocationId,
          },
        });
    }
  });
}
