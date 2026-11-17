/**
 * A user's effective store settings: what they saved, or SPEC §2.7 pre-selection defaults until they
 * save. Shared by the API (GET /me/stores, comparison, history) and alert evaluation so the two can
 * never disagree about which stores and member prices apply.
 */
import { preselectChains } from '@sgs/core';
import { storeLocations, stores, users, userStores, type Db } from '@sgs/db';
import { asc, eq } from 'drizzle-orm';

export interface UserStoreView {
  readonly radiusMiles: number;
  readonly fallback: boolean;
  readonly stores: {
    readonly id: number;
    readonly slug: string;
    readonly name: string;
    readonly brandColor: string;
    readonly sortOrder: number;
    readonly requiresMembership: boolean;
    readonly loyaltyProgram: string | null;
    readonly enabled: boolean;
    readonly hasMembership: boolean;
    readonly hasLoyalty: boolean;
    readonly preferredLocationId: number | null;
    readonly nearestLocation: {
      readonly id: number;
      readonly name: string;
      readonly distanceMiles: number;
    } | null;
    readonly preselected: boolean;
    readonly saved: boolean;
  }[];
}

export async function userStoreView(
  db: Db,
  userId: string,
  radiusMiles: number,
): Promise<UserStoreView> {
  const [user] = await db
    .select({ lat: users.homeLat, lng: users.homeLng })
    .from(users)
    .where(eq(users.id, userId));
  const all = await db
    .select({
      id: stores.id,
      slug: stores.slug,
      name: stores.name,
      brandColor: stores.brandColor,
      sortOrder: stores.sortOrder,
      requiresMembership: stores.requiresMembership,
      loyaltyProgram: stores.loyaltyProgram,
    })
    .from(stores)
    .orderBy(asc(stores.sortOrder));
  const locs = await db
    .select({
      id: storeLocations.id,
      storeId: storeLocations.storeId,
      name: storeLocations.name,
      lat: storeLocations.lat,
      lng: storeLocations.lng,
    })
    .from(storeLocations);
  const saved = await db.select().from(userStores).where(eq(userStores.userId, userId));
  const savedBy = new Map(saved.map((s) => [s.storeId, s]));
  const home =
    user && user.lat !== null && user.lng !== null ? { lat: user.lat, lng: user.lng } : null;
  const pre = home
    ? preselectChains(
        home,
        all.map((s) => ({ storeId: s.id, locations: locs.filter((l) => l.storeId === s.id) })),
        radiusMiles,
      )
    : null;
  return {
    radiusMiles,
    fallback: pre?.fallback ?? false,
    stores: all.map((s) => {
      const d = pre?.chains.find((c) => c.storeId === s.id);
      const nearest =
        d?.nearestLocationId != null ? locs.find((l) => l.id === d.nearestLocationId) : undefined;
      const mine = savedBy.get(s.id);
      return {
        ...s,
        enabled: mine ? mine.enabled : (d?.preselected ?? false),
        hasMembership: mine?.hasMembership ?? false,
        hasLoyalty: mine ? mine.hasLoyalty : s.loyaltyProgram !== null,
        preferredLocationId: mine?.preferredLocationId ?? null,
        nearestLocation:
          nearest && d?.distanceMiles != null
            ? { id: nearest.id, name: nearest.name, distanceMiles: d.distanceMiles }
            : null,
        preselected: d?.preselected ?? false,
        saved: mine !== undefined,
      };
    }),
  };
}
