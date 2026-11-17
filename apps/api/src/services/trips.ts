/**
 * Trips: the savings ledger (SPEC Phase 6). A trip is a plan the user committed to. The server
 * recomputes the plan at `price_as_of` (= the day shopped) and snapshots it; later price changes
 * never touch a committed trip.
 */
import {
  addDays,
  bestRoute,
  diffDays,
  fuelCostCents,
  planFromComparison,
  PlanError,
  type IsoDate,
  type LatLng,
} from '@sgs/core';
import { storeLocations, tripItems, trips, users, type Db } from '@sgs/db';
import { userStoreView } from '@sgs/pricing';
import type { CommitTripRequest, TripDetail, TripItem, TripSummary } from '@sgs/shared';
import { and, desc, eq } from 'drizzle-orm';
import { AppError } from '../errors.js';
import { computeComparison } from './compare.js';

/** How far back a trip may be logged (price history covers 12 months). */
export const MAX_TRIP_AGE_DAYS = 365;

export interface TripOpts {
  readonly today: IsoDate;
  readonly radiusMiles: number;
  readonly metro: string;
  readonly defaultOrigin: LatLng;
  readonly fuelCentsPerGalDefault: number;
}

/** Immutable snapshot stored in trips.plan (v1). */
interface PlanSnapshot {
  readonly v: 1;
  readonly listName: string;
  readonly stores: { id: number; name: string }[];
  readonly baselineStore: { id: number; name: string };
  readonly items: TripItem[];
  readonly skipped: TripDetail['skipped'];
  readonly mpg: number;
  readonly fuelCentsPerGal: number;
}

export interface TripSettings {
  readonly home: LatLng;
  readonly mpg: number;
  readonly fuelCentsPerGal: number;
  /** Each store's stop: the user's preferred location, else the nearest one. */
  readonly locations: Map<number, LatLng>;
}

/** Home, car and store stops, exactly as a trip is costed. Shared with the optimizer. */
export async function tripSettings(
  db: Db,
  userId: string,
  opts: Pick<TripOpts, 'radiusMiles' | 'defaultOrigin' | 'fuelCentsPerGalDefault'>,
): Promise<TripSettings> {
  const [user] = await db
    .select({
      lat: users.homeLat,
      lng: users.homeLng,
      mpg: users.vehicleMpg,
      fuel: users.fuelCentsPerGal,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new AppError('NOT_FOUND', 404, 'Not found');
  const view = await userStoreView(db, userId, opts.radiusMiles);
  const locs = await db
    .select({ id: storeLocations.id, lat: storeLocations.lat, lng: storeLocations.lng })
    .from(storeLocations);
  const locations = new Map<number, LatLng>();
  for (const s of view.stores) {
    const loc = locs.find((l) => l.id === (s.preferredLocationId ?? s.nearestLocation?.id));
    if (loc) locations.set(s.id, { lat: loc.lat, lng: loc.lng });
  }
  return {
    home:
      user.lat !== null && user.lng !== null
        ? { lat: user.lat, lng: user.lng }
        : opts.defaultOrigin,
    mpg: user.mpg,
    fuelCentsPerGal: user.fuel ?? opts.fuelCentsPerGalDefault,
    locations,
  };
}

export async function commitTrip(
  db: Db,
  userId: string,
  input: CommitTripRequest,
  opts: TripOpts,
): Promise<TripDetail> {
  const age = diffDays(opts.today, input.shoppedOn);
  if (age < 0 || age > MAX_TRIP_AGE_DAYS) {
    throw new AppError(
      'VALIDATION_FAILED',
      422,
      `Pick a date between ${addDays(opts.today, -MAX_TRIP_AGE_DAYS)} and ${opts.today}`,
      [{ path: ['shoppedOn'], message: 'Out of range' }],
    );
  }
  const priceAsOf = input.shoppedOn;
  const { list, items, prods, storeRows, result } = await computeComparison(
    db,
    userId,
    input.listId,
    { asOf: priceAsOf, radiusMiles: opts.radiusMiles, metro: opts.metro },
  );

  let plan;
  try {
    plan = planFromComparison(result, input.plan.storeIds);
  } catch (e) {
    if (e instanceof PlanError) throw new AppError('VALIDATION_FAILED', 422, e.message);
    throw e;
  }

  const trip = await tripSettings(db, userId, opts);
  const route = bestRoute(
    trip.home,
    plan.storeIds.flatMap((id) => {
      const at = trip.locations.get(id);
      return at ? [{ id, at }] : [];
    }),
  );
  const fuelCentsPerGal = trip.fuelCentsPerGal;
  const fuel = fuelCostCents(route.miles, trip.mpg, fuelCentsPerGal);
  const order = [...route.order, ...plan.storeIds.filter((id) => !route.order.includes(id))];

  const storeName = (id: number) =>
    storeRows.find((s) => s.id === id)?.name ?? `Store ${String(id)}`;
  const itemById = new Map(items.map((i) => [i.id, i]));
  const snapItems: TripItem[] = plan.items.map((pi) => {
    const li = itemById.get(pi.itemId);
    const p = li?.productId ? prods.get(li.productId) : undefined;
    return {
      itemId: pi.itemId,
      rawText: li?.rawText ?? '',
      productName: p?.name ?? pi.title,
      categoryName: p?.categoryName ?? null,
      storeId: pi.storeId,
      storeItemId: pi.storeItemId,
      title: pi.title,
      packages: pi.packages,
      lineCents: pi.lineCents,
      baselineLineCents: pi.baselineLineCents,
      unitPriceCents: Math.round(pi.unitPriceCents * 10_000) / 10_000,
      displayUnit: p?.displayUnit ?? 'ea',
      onSale: pi.onSale,
      promoLabel: pi.promoLabel,
      approximate: pi.approximate,
    };
  });
  const snapshot: PlanSnapshot = {
    v: 1,
    listName: list.name,
    stores: order.map((id) => ({ id, name: storeName(id) })),
    baselineStore: { id: plan.baselineStoreId, name: storeName(plan.baselineStoreId) },
    items: snapItems,
    skipped: plan.skipped.map((s) => ({
      rawText: itemById.get(s.itemId)?.rawText ?? '',
      reason: s.reason,
    })),
    mpg: trip.mpg,
    fuelCentsPerGal,
  };

  const tripId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(trips)
      .values({
        userId,
        listId: list.id,
        planType: order.length > 1 ? 'multi' : 'single',
        storeIds: order,
        baselineStoreId: plan.baselineStoreId,
        itemsTotalCents: plan.itemsCents,
        fuelCostCents: fuel,
        distanceMiles: route.miles,
        baselineTotalCents: plan.baselineCents,
        priceAsOf,
        shoppedOn: input.shoppedOn,
        plan: snapshot as unknown as Record<string, unknown>,
      })
      .returning({ id: trips.id });
    if (!row) throw new Error('trip insert returned nothing');
    await tx.insert(tripItems).values(
      plan.items.map((pi) => {
        const li = itemById.get(pi.itemId);
        const p = li?.productId ? prods.get(li.productId) : undefined;
        return {
          tripId: row.id,
          productId: p?.id ?? null,
          storeItemId: pi.storeItemId,
          storeId: pi.storeId,
          categoryId: p?.categoryId ?? null,
          packages: pi.packages,
          baseQuantity: pi.boughtBase,
          lineTotalCents: pi.lineCents,
          baselineLineCents: pi.baselineLineCents,
        };
      }),
    );
    return row.id;
  });
  return getTrip(db, userId, tripId);
}

type TripRow = typeof trips.$inferSelect;

function toSummary(row: TripRow): TripSummary {
  const snap = row.plan as unknown as PlanSnapshot;
  return {
    id: row.id,
    listId: row.listId,
    listName: snap.listName,
    planType: row.planType,
    stores: snap.stores,
    baselineStore: snap.baselineStore,
    itemCount: snap.items.length,
    itemsTotalCents: row.itemsTotalCents,
    fuelCostCents: row.fuelCostCents,
    distanceMiles: row.distanceMiles,
    baselineTotalCents: row.baselineTotalCents,
    savingsCents:
      row.savingsCents ?? row.baselineTotalCents - row.itemsTotalCents - row.fuelCostCents,
    priceAsOf: row.priceAsOf,
    shoppedOn: row.shoppedOn,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getTrip(db: Db, userId: string, id: string): Promise<TripDetail> {
  const [row] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, id), eq(trips.userId, userId)));
  if (!row) throw new AppError('NOT_FOUND', 404, 'Trip not found');
  const snap = row.plan as unknown as PlanSnapshot;
  return {
    ...toSummary(row),
    items: snap.items,
    skipped: snap.skipped,
    mpg: snap.mpg,
    fuelCentsPerGal: snap.fuelCentsPerGal,
  };
}

export async function listTrips(
  db: Db,
  userId: string,
  opts: { limit: number; cursor: number },
): Promise<{ trips: TripSummary[]; nextCursor: string | null }> {
  const rows = await db
    .select()
    .from(trips)
    .where(eq(trips.userId, userId))
    .orderBy(desc(trips.shoppedOn), desc(trips.createdAt), desc(trips.id))
    .limit(opts.limit + 1)
    .offset(opts.cursor);
  return {
    trips: rows.slice(0, opts.limit).map(toSummary),
    nextCursor: rows.length > opts.limit ? String(opts.cursor + opts.limit) : null,
  };
}

export async function deleteTrip(db: Db, userId: string, id: string): Promise<void> {
  const r = await db
    .delete(trips)
    .where(and(eq(trips.id, id), eq(trips.userId, userId)))
    .returning({ id: trips.id });
  if (r.length === 0) throw new AppError('NOT_FOUND', 404, 'Trip not found');
}
