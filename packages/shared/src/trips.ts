import { z } from 'zod';
import { UnitCode } from './lists.js';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/**
 * Commit a plan as a trip. The client names the stores only. The server recomputes the plan at
 * `price_as_of` and stores a snapshot, so totals sent by a client are never trusted (and are
 * rejected: the schema is strict).
 */
export const CommitTripRequest = z
  .object({
    listId: z.uuid(),
    plan: z
      .object({
        storeIds: z
          .array(z.number().int().positive())
          .min(1)
          .max(3)
          .refine((ids) => new Set(ids).size === ids.length, 'Stores must be distinct'),
      })
      .strict(),
    shoppedOn: IsoDate,
  })
  .strict();
export type CommitTripRequest = z.infer<typeof CommitTripRequest>;

export const TripStore = z.object({ id: z.number().int(), name: z.string() });

export const TripSummary = z.object({
  id: z.uuid(),
  listId: z.uuid().nullable(),
  listName: z.string(),
  planType: z.enum(['single', 'multi']),
  /** In route order. */
  stores: z.array(TripStore),
  baselineStore: TripStore,
  itemCount: z.number().int(),
  itemsTotalCents: z.number().int(),
  fuelCostCents: z.number().int(),
  distanceMiles: z.number(),
  baselineTotalCents: z.number().int(),
  /** baseline − (items + fuel); can be negative. */
  savingsCents: z.number().int(),
  priceAsOf: IsoDate,
  shoppedOn: IsoDate,
  createdAt: z.string(),
});
export type TripSummary = z.infer<typeof TripSummary>;

export const TripItem = z.object({
  itemId: z.string(),
  rawText: z.string(),
  productName: z.string(),
  categoryName: z.string().nullable(),
  storeId: z.number().int(),
  storeItemId: z.uuid(),
  title: z.string(),
  packages: z.number().int().nullable(),
  lineCents: z.number().int(),
  baselineLineCents: z.number().int(),
  unitPriceCents: z.number(),
  displayUnit: UnitCode,
  onSale: z.boolean(),
  promoLabel: z.string().nullable(),
  approximate: z.boolean(),
});
export type TripItem = z.infer<typeof TripItem>;

export const TripDetail = TripSummary.extend({
  items: z.array(TripItem),
  /** List items not in the trip, and why. */
  skipped: z.array(
    z.object({
      rawText: z.string(),
      reason: z.enum(['unpriced', 'not_in_plan_stores', 'not_at_baseline']),
    }),
  ),
  mpg: z.number(),
  fuelCentsPerGal: z.number().int(),
});
export type TripDetail = z.infer<typeof TripDetail>;

export const TripsResponse = z.object({
  trips: z.array(TripSummary),
  nextCursor: z.string().nullable(),
});
export const TripResponse = z.object({ trip: TripDetail });

/** Dashboard/export range. Both default server-side: `to` = today, `from` = 1 year before `to`. */
export const DashboardRangeQuery = z.object({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
});

const Range = { from: IsoDate, to: IsoDate };

export const DashboardSummary = z.object({
  ...Range,
  tripCount: z.number().int(),
  totalSavedCents: z.number().int(),
  /** items + fuel */
  totalSpentCents: z.number().int(),
  baselineTotalCents: z.number().int(),
  fuelSpentCents: z.number().int(),
  /** totalSaved ÷ baselineTotal, one decimal; null with no trips. */
  avgSavingsPct: z.number().nullable(),
  /** Store where the user saved the most on items (before fuel). */
  bestStore: z
    .object({ storeId: z.number().int(), name: z.string(), savedCents: z.number().int() })
    .nullable(),
});
export type DashboardSummary = z.infer<typeof DashboardSummary>;

export const SeriesMetric = z.enum(['savings', 'spend']);
export const SeriesInterval = z.enum(['week', 'month']);
export const DashboardSeriesQuery = DashboardRangeQuery.extend({
  metric: SeriesMetric.default('savings'),
  interval: SeriesInterval.default('month'),
});
export const DashboardSeries = z.object({
  ...Range,
  metric: SeriesMetric,
  interval: SeriesInterval,
  /** Every bucket in the range, empty ones as zero. */
  points: z.array(
    z.object({ start: IsoDate, valueCents: z.number().int(), tripCount: z.number().int() }),
  ),
});
export type DashboardSeries = z.infer<typeof DashboardSeries>;

export const BreakdownBy = z.enum(['store', 'category']);
export const DashboardBreakdownQuery = DashboardRangeQuery.extend({
  by: BreakdownBy.default('store'),
});
export const DashboardBreakdown = z.object({
  ...Range,
  by: BreakdownBy,
  /** Item-level (fuel isn't attributable to a store or category). Most saved first. */
  rows: z.array(
    z.object({
      key: z.number().int(),
      label: z.string(),
      spentCents: z.number().int(),
      savedCents: z.number().int(),
      itemCount: z.number().int(),
    }),
  ),
});
export type DashboardBreakdown = z.infer<typeof DashboardBreakdown>;
