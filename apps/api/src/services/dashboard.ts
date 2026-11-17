/**
 * Savings dashboard (SPEC Phase 6). Reads committed trips only. `shopped_on` is already an
 * America/Chicago calendar date, so week/month buckets need no time-zone math.
 */
import { addDays, bucketsBetween, diffDays, isIsoDate, type IsoDate } from '@sgs/core';
import type { Db } from '@sgs/db';
import type { DashboardBreakdown, DashboardSeries, DashboardSummary } from '@sgs/shared';
import { sql } from 'drizzle-orm';
import { AppError } from '../errors.js';

/** Keeps weekly series bounded (≤ ~520 buckets). */
export const MAX_RANGE_DAYS = 3660;

export interface DateRange {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

/** Defaults: `to` = today, `from` = one year before `to`. */
export function resolveRange(
  q: { from?: string | undefined; to?: string | undefined },
  today: IsoDate,
): DateRange {
  const to = q.to ?? today;
  const from = q.from ?? addDays(to, -365);
  for (const [k, v] of [
    ['from', from],
    ['to', to],
  ] as const) {
    if (!isIsoDate(v)) {
      throw new AppError('VALIDATION_FAILED', 400, `${k} must be a real date (YYYY-MM-DD)`, [
        { path: [k], message: 'Invalid date' },
      ]);
    }
  }
  if (diffDays(to, from) < 0) {
    throw new AppError('VALIDATION_FAILED', 400, '`from` must be on or before `to`', [
      { path: ['from'], message: 'After to' },
    ]);
  }
  if (diffDays(to, from) > MAX_RANGE_DAYS) {
    throw new AppError('VALIDATION_FAILED', 400, 'Range is limited to 10 years', [
      { path: ['from'], message: 'Range too long' },
    ]);
  }
  return { from, to };
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

const inRange = (userId: string, r: DateRange) =>
  sql`t.user_id = ${userId} AND t.shopped_on BETWEEN ${r.from}::date AND ${r.to}::date`;

export async function summary(db: Db, userId: string, r: DateRange): Promise<DashboardSummary> {
  const [totals] = (
    await db.execute(sql`
      SELECT count(*) AS trips,
             sum(t.savings_cents) AS saved,
             sum(t.items_total_cents + t.fuel_cost_cents) AS spent,
             sum(t.baseline_total_cents) AS baseline,
             sum(t.fuel_cost_cents) AS fuel
      FROM trips t WHERE ${inRange(userId, r)}`)
  ).rows;
  const [best] = (
    await db.execute(sql`
      SELECT ti.store_id AS "storeId", s.name, sum(ti.baseline_line_cents - ti.line_total_cents) AS saved
      FROM trip_items ti JOIN trips t ON t.id = ti.trip_id JOIN stores s ON s.id = ti.store_id
      WHERE ${inRange(userId, r)}
      GROUP BY ti.store_id, s.name
      ORDER BY saved DESC, ti.store_id
      LIMIT 1`)
  ).rows;
  const tripCount = n(totals?.trips);
  const saved = n(totals?.saved);
  const baseline = n(totals?.baseline);
  return {
    ...r,
    tripCount,
    totalSavedCents: saved,
    totalSpentCents: n(totals?.spent),
    baselineTotalCents: baseline,
    fuelSpentCents: n(totals?.fuel),
    avgSavingsPct: baseline > 0 ? Math.round((saved / baseline) * 1000) / 10 : null,
    bestStore:
      best && n(best.saved) > 0
        ? { storeId: n(best.storeId), name: String(best.name), savedCents: n(best.saved) }
        : null,
  };
}

export async function series(
  db: Db,
  userId: string,
  r: DateRange,
  metric: 'savings' | 'spend',
  interval: 'week' | 'month',
): Promise<DashboardSeries> {
  const value =
    metric === 'savings' ? sql`t.savings_cents` : sql`t.items_total_cents + t.fuel_cost_cents`;
  const rows = (
    await db.execute(sql`
      SELECT to_char(date_trunc(${interval}, t.shopped_on::timestamp), 'YYYY-MM-DD') AS start,
             sum(${value}) AS value, count(*) AS trips
      FROM trips t WHERE ${inRange(userId, r)}
      GROUP BY 1`)
  ).rows;
  const by = new Map(rows.map((row) => [String(row.start), row]));
  return {
    ...r,
    metric,
    interval,
    points: bucketsBetween(r.from, r.to, interval).map((start) => {
      const row = by.get(start);
      return { start, valueCents: n(row?.value), tripCount: n(row?.trips) };
    }),
  };
}

export async function breakdown(
  db: Db,
  userId: string,
  r: DateRange,
  by: 'store' | 'category',
): Promise<DashboardBreakdown> {
  const rows = (
    by === 'store'
      ? await db.execute(sql`
          SELECT ti.store_id AS key, s.name AS label,
                 sum(ti.line_total_cents) AS spent,
                 sum(ti.baseline_line_cents - ti.line_total_cents) AS saved, count(*) AS items
          FROM trip_items ti JOIN trips t ON t.id = ti.trip_id JOIN stores s ON s.id = ti.store_id
          WHERE ${inRange(userId, r)}
          GROUP BY ti.store_id, s.name`)
      : await db.execute(sql`
          SELECT coalesce(c.id, 0) AS key, coalesce(c.name, 'Other') AS label,
                 sum(ti.line_total_cents) AS spent,
                 sum(ti.baseline_line_cents - ti.line_total_cents) AS saved, count(*) AS items
          FROM trip_items ti JOIN trips t ON t.id = ti.trip_id
          LEFT JOIN categories c ON c.id = ti.category_id
          WHERE ${inRange(userId, r)}
          GROUP BY 1, 2`)
  ).rows;
  return {
    ...r,
    by,
    rows: rows
      .map((row) => ({
        key: n(row.key),
        label: String(row.label),
        spentCents: n(row.spent),
        savedCents: n(row.saved),
        itemCount: n(row.items),
      }))
      .sort((a, b) => b.savedCents - a.savedCents || a.label.localeCompare(b.label)),
  };
}
