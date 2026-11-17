/** Price history, alerts and notifications (SPEC Phase 5). */
import {
  addDays,
  diffDays,
  effectivePrice,
  lowestIn,
  lowestOn,
  stepSeries,
  yearEndingOn,
  type IsoDate,
} from '@sgs/core';
import { notifications, priceAlerts, storeItems, type Db } from '@sgs/db';
import { loadRawPeriods, unitPeriodsFor, userStoreView, type AlertPayload } from '@sgs/pricing';
import {
  RANGE_DAYS,
  type Alert,
  type CreateAlertRequest,
  type HistoryRange,
  type HistoryResponse,
  type Notification,
} from '@sgs/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { UpdateAlertRequest } from '@sgs/shared';
import { AppError } from '../errors.js';
import { productsByIds } from './catalog.js';

interface Ctx {
  readonly radiusMiles: number;
  readonly metro: string;
}

const storeInfo = (s: {
  id: number;
  slug: string;
  name: string;
  brandColor: string;
  requiresMembership: boolean;
  loyaltyProgram: string | null;
}) => ({
  id: s.id,
  slug: s.slug,
  name: s.name,
  brandColor: s.brandColor,
  requiresMembership: s.requiresMembership,
  loyaltyProgram: s.loyaltyProgram,
});
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export async function productHistory(
  db: Db,
  userId: string,
  productId: string,
  range: HistoryRange,
  asOf: IsoDate,
  ctx: Ctx,
): Promise<HistoryResponse> {
  const product = (await productsByIds(db, [productId])).get(productId);
  if (!product) throw new AppError('NOT_FOUND', 404, 'Product not found');
  const from = addDays(asOf, -(RANGE_DAYS[range] - 1));
  const year = yearEndingOn(asOf);
  const [view, rows] = await Promise.all([
    userStoreView(db, userId, ctx.radiusMiles),
    loadRawPeriods(
      db,
      [productId],
      { from: diffDays(from, year.from) < 0 ? from : year.from, to: asOf },
      ctx.metro,
    ),
  ]);
  const byStore = unitPeriodsFor(rows, productId, product, view);
  let low: { unitPriceCents: number; storeId: number; date: string } | null = null;
  let current: { unitPriceCents: number; storeId: number } | null = null;
  const series: HistoryResponse['series'] = [];
  for (const s of view.stores) {
    const entry = byStore.get(s.id);
    if (!entry) continue;
    series.push({
      storeId: s.id,
      points: stepSeries(entry.periods, { from, to: asOf }).map((p) => ({
        date: p.date,
        unitPriceCents: p.unitPriceCents === null ? null : r4(p.unitPriceCents),
      })),
    });
    const l = lowestIn(entry.periods, year);
    if (
      l &&
      (low === null ||
        l.unitPriceCents < low.unitPriceCents ||
        (l.unitPriceCents === low.unitPriceCents && diffDays(l.date, low.date) < 0))
    ) {
      low = { unitPriceCents: l.unitPriceCents, storeId: s.id, date: l.date };
    }
    const c = lowestOn(entry.periods, asOf);
    if (c !== null && (current === null || c < current.unitPriceCents))
      current = { unitPriceCents: c, storeId: s.id };
  }
  return {
    product,
    range,
    from,
    to: asOf,
    stores: view.stores.map(storeInfo),
    series,
    historicLow: low ? { ...low, unitPriceCents: r4(low.unitPriceCents) } : null,
    current: current ? { ...current, unitPriceCents: r4(current.unitPriceCents) } : null,
    atHistoricLow:
      current !== null && low !== null && current.unitPriceCents <= low.unitPriceCents + 1e-9,
  };
}

/** Package price over time for one store item (regular vs what this user pays). */
export async function storeItemHistory(
  db: Db,
  userId: string,
  storeItemId: string,
  range: HistoryRange,
  asOf: IsoDate,
  ctx: Ctx,
) {
  const [item] = await db
    .select({ id: storeItems.id, title: storeItems.title, storeId: storeItems.storeId })
    .from(storeItems)
    .where(eq(storeItems.id, storeItemId));
  if (!item) throw new AppError('NOT_FOUND', 404, 'Store item not found');
  const from = addDays(asOf, -(RANGE_DAYS[range] - 1));
  const view = await userStoreView(db, userId, ctx.radiusMiles);
  const store = view.stores.find((s) => s.id === item.storeId);
  if (!store) throw new AppError('NOT_FOUND', 404, 'Store item not found');
  const r = await db.execute<{
    from: string;
    to: string | null;
    regular: number;
    sale: number | null;
    label: string | null;
    minQty: number;
    memberOnly: boolean;
  }>(sql`
    SELECT lower(valid_during)::text AS "from", upper(valid_during)::text AS "to", regular_price_cents AS regular,
           sale_price_cents AS sale, promo_label AS label, min_qty AS "minQty", member_only AS "memberOnly"
    FROM price_points
    WHERE store_item_id = ${storeItemId} AND metro = ${ctx.metro} AND store_location_id IS NULL
      AND valid_during && daterange(${from}::date, ${asOf}::date, '[]')
    ORDER BY lower(valid_during)`);
  return {
    storeItemId,
    title: item.title,
    storeId: item.storeId,
    range,
    from,
    to: asOf,
    periods: r.rows.map((p) => {
      const eff = effectivePrice(
        {
          storeItemId,
          storeId: item.storeId,
          productId: '',
          title: item.title,
          brand: null,
          isStoreBrand: false,
          basis: 'per_package',
          baseQuantity: 1,
          unit: 'ea',
          regularPriceCents: p.regular,
          salePriceCents: p.sale,
          promoLabel: p.label,
          minQty: p.minQty,
          memberOnly: p.memberOnly,
        },
        store,
        store,
      );
      return {
        from: diffDays(p.from, from) < 0 ? from : p.from,
        to: p.to !== null && diffDays(p.to, addDays(asOf, 1)) <= 0 ? p.to : null,
        regularPriceCents: p.regular,
        priceCents: eff.priceCents,
        promoLabel: eff.promoLabel,
      };
    }),
  };
}

// ───────────── alerts ─────────────
async function toAlerts(db: Db, rows: (typeof priceAlerts.$inferSelect)[]): Promise<Alert[]> {
  const prods = await productsByIds(db, [...new Set(rows.map((r) => r.productId))]);
  return rows.flatMap((r) => {
    const product = prods.get(r.productId);
    return product
      ? [
          {
            id: r.id,
            product,
            kind: r.kind,
            targetCents: r.targetCents,
            active: r.active,
            lastTriggeredAt: r.lastTriggeredAt?.toISOString() ?? null,
            createdAt: r.createdAt.toISOString(),
          },
        ]
      : [];
  });
}

export async function listAlerts(db: Db, userId: string): Promise<Alert[]> {
  const rows = await db
    .select()
    .from(priceAlerts)
    .where(eq(priceAlerts.userId, userId))
    .orderBy(desc(priceAlerts.createdAt));
  return toAlerts(db, rows);
}

/** Create, or re-activate/re-target the user's alert of that kind for that product (one per kind). */
export async function upsertAlert(
  db: Db,
  userId: string,
  input: CreateAlertRequest,
  now: Date,
): Promise<Alert> {
  if (!(await productsByIds(db, [input.productId])).has(input.productId)) {
    throw new AppError('VALIDATION_FAILED', 422, 'Unknown product', [
      { path: ['productId'], message: 'Unknown product' },
    ]);
  }
  const [row] = await db
    .insert(priceAlerts)
    .values({
      userId,
      productId: input.productId,
      kind: input.kind,
      targetCents: input.targetCents ?? null,
      active: true,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [priceAlerts.userId, priceAlerts.productId, priceAlerts.kind],
      set: { active: true, targetCents: input.targetCents ?? null },
    })
    .returning();
  if (!row) throw new Error('alert upsert failed');
  const [alert] = await toAlerts(db, [row]);
  if (!alert) throw new Error('alert product missing');
  return alert;
}

async function ownedAlert(db: Db, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(priceAlerts)
    .where(and(eq(priceAlerts.id, id), eq(priceAlerts.userId, userId)));
  if (!row) throw new AppError('NOT_FOUND', 404, 'Alert not found');
  return row;
}

export async function updateAlert(
  db: Db,
  userId: string,
  id: string,
  input: z.infer<typeof UpdateAlertRequest>,
): Promise<Alert> {
  const cur = await ownedAlert(db, userId, id);
  if (input.targetCents !== undefined && cur.kind !== 'target_price') {
    throw new AppError('VALIDATION_FAILED', 422, 'Only target-price alerts have a target', [
      { path: ['targetCents'], message: 'Not a target-price alert' },
    ]);
  }
  const [row] = await db
    .update(priceAlerts)
    .set({
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.targetCents !== undefined ? { targetCents: input.targetCents } : {}),
    })
    .where(eq(priceAlerts.id, id))
    .returning();
  const [alert] = await toAlerts(db, row ? [row] : []);
  if (!alert) throw new AppError('NOT_FOUND', 404, 'Alert not found');
  return alert;
}

export async function deleteAlert(db: Db, userId: string, id: string): Promise<void> {
  await ownedAlert(db, userId, id);
  await db.delete(priceAlerts).where(eq(priceAlerts.id, id));
}

// ───────────── notifications ─────────────
export async function listNotifications(
  db: Db,
  userId: string,
  unreadOnly: boolean,
): Promise<{ notifications: Notification[]; unreadCount: number }> {
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(eq(notifications.userId, userId), unreadOnly ? isNull(notifications.readAt) : undefined),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(50);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return {
    unreadCount: count?.n ?? 0,
    notifications: rows.map((r) => {
      const p = r.payload as AlertPayload;
      return {
        id: r.id,
        kind: p.kind,
        createdAt: r.createdAt.toISOString(),
        read: r.readAt !== null,
        productId: p.productId,
        productName: p.productName,
        storeName: p.storeName,
        unitPriceCents: p.unitPriceCents,
        displayUnit: p.displayUnit,
        priorLowCents: p.priorLowCents,
        targetCents: p.targetCents,
        promoLabel: p.promoLabel,
        asOf: p.asOf,
      };
    }),
  };
}

export async function markRead(
  db: Db,
  userId: string,
  /** A notification id, or 'all'. */
  id: string,
  now: Date,
): Promise<void> {
  if (id === 'all') {
    await db
      .update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return;
  }
  const [row] = await db
    .update(notifications)
    .set({ readAt: sql`COALESCE(${notifications.readAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning({ id: notifications.id });
  if (!row) throw new AppError('NOT_FOUND', 404, 'Notification not found');
}
