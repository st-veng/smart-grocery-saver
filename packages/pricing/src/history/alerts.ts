/** Alert evaluation (SPEC Phase 5): runs after each ingested day (daily sync / sim:advance). */
import {
  addDays,
  diffDays,
  lowestIn,
  PRESELECT_RADIUS_MILES,
  shouldTrigger,
  yearBefore,
  type IsoDate,
  type UnitCode,
} from '@sgs/core';
import { notifications, priceAlerts, products, type Db } from '@sgs/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { userStoreView, type UserStoreView } from '../user-stores.js';
import { loadRawPeriods, unitPeriodsFor } from './periods.js';

export interface AlertPayload extends Record<string, unknown> {
  readonly kind: 'historic_low' | 'target_price';
  readonly productId: string;
  readonly productSlug: string;
  readonly productName: string;
  readonly storeId: number;
  readonly storeName: string;
  readonly unitPriceCents: number;
  readonly displayUnit: UnitCode;
  readonly priorLowCents: number | null;
  readonly targetCents: number | null;
  readonly promoLabel: string | null;
  readonly asOf: IsoDate;
}

export interface EvaluateResult {
  readonly evaluated: number;
  readonly created: number;
}

/**
 * Evaluate every active alert for the market date `asOf`. Notifications are de-duplicated per
 * (alert, price point), so re-running for the same day — or a price that stays low for a week —
 * notifies once.
 */
export async function evaluateAlerts(
  db: Db,
  asOf: IsoDate,
  opts: { metro?: string; radiusMiles?: number; now?: Date } = {},
): Promise<EvaluateResult> {
  const metro = opts.metro ?? 'DFW';
  const radius = opts.radiusMiles ?? PRESELECT_RADIUS_MILES;
  const now = opts.now ?? new Date();
  const alerts = await db
    .select({
      id: priceAlerts.id,
      userId: priceAlerts.userId,
      productId: priceAlerts.productId,
      kind: priceAlerts.kind,
      targetCents: priceAlerts.targetCents,
      slug: products.slug,
      name: products.name,
      dimension: products.dimension,
      displayUnit: products.displayUnit,
      avgEachGrams: products.avgEachGrams,
    })
    .from(priceAlerts)
    .innerJoin(products, eq(products.id, priceAlerts.productId))
    .where(eq(priceAlerts.active, true));
  if (alerts.length === 0) return { evaluated: 0, created: 0 };

  const window = { from: addDays(asOf, -365), to: asOf };
  const rows = await loadRawPeriods(
    db,
    [...new Set(alerts.map((a) => a.productId))],
    window,
    metro,
  );
  const views = new Map<string, UserStoreView>();
  let created = 0;

  for (const a of alerts) {
    let view = views.get(a.userId);
    if (!view) {
      view = await userStoreView(db, a.userId, radius);
      views.set(a.userId, view);
    }
    const byStore = unitPeriodsFor(rows, a.productId, a, view);
    let current: {
      unit: number;
      storeId: number;
      storeName: string;
      pricePointId: number;
      promoLabel: string | null;
    } | null = null;
    let priorLow: number | null = null;
    for (const { store, periods } of byStore.values()) {
      for (const p of periods) {
        const coversToday =
          diffDays(asOf, p.from) >= 0 && (p.to === null || diffDays(p.to, asOf) > 0);
        if (coversToday && (current === null || p.unitPriceCents < current.unit)) {
          current = {
            unit: p.unitPriceCents,
            storeId: store.id,
            storeName: store.name,
            pricePointId: p.pricePointId,
            promoLabel: p.promoLabel,
          };
        }
      }
      const low = lowestIn(periods, yearBefore(asOf));
      if (low && (priorLow === null || low.unitPriceCents < priorLow))
        priorLow = low.unitPriceCents;
    }
    if (!current || !shouldTrigger(a.kind, current.unit, priorLow, a.targetCents)) continue;
    const payload: AlertPayload = {
      kind: a.kind,
      productId: a.productId,
      productSlug: a.slug,
      productName: a.name,
      storeId: current.storeId,
      storeName: current.storeName,
      unitPriceCents: Math.round(current.unit * 10_000) / 10_000,
      displayUnit: a.displayUnit,
      priorLowCents: priorLow === null ? null : Math.round(priorLow * 10_000) / 10_000,
      targetCents: a.targetCents,
      promoLabel: current.promoLabel,
      asOf,
    };
    const inserted = await db
      .insert(notifications)
      .values({
        userId: a.userId,
        alertId: a.id,
        kind: a.kind,
        payload,
        dedupeKey: `${a.id}:${String(current.pricePointId)}`,
        createdAt: now,
      })
      .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
      .returning({ id: notifications.id });
    if (inserted.length > 0) {
      created++;
      await db.update(priceAlerts).set({ lastTriggeredAt: now }).where(eq(priceAlerts.id, a.id));
    }
  }
  return { evaluated: alerts.length, created };
}

/** Unread notification count — used by tests and the sim CLI summary. */
export async function unreadCount(db: Db, userIds: readonly string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(inArray(notifications.userId, [...userIds]), sql`${notifications.readAt} IS NULL`));
  return r?.n ?? 0;
}
