import { z } from 'zod';
import { CompareStoreInfo } from './compare.js';

export const OptimizeRequest = z
  .object({
    maxStores: z.number().int().min(1).max(3).default(3),
    /** Overrides for "what if" runs. Without them the plan is costed exactly as a trip would be. */
    origin: z
      .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
      .strict()
      .optional(),
    mpg: z.number().positive().max(150).optional(),
    fuelCentsPerGal: z.number().int().positive().max(2000).optional(),
    /** 0 (default) = your time is free (Q-4). */
    timeValueCentsPerHour: z.number().int().min(0).max(20_000).default(0),
    minutesPerStop: z.number().int().min(0).max(120).default(10),
  })
  .strict();
export type OptimizeRequest = z.input<typeof OptimizeRequest>;

export const OptimizedPlan = z.object({
  /** Stores used, ascending — send these to POST /trips to log this plan. */
  storeIds: z.array(z.number().int()),
  /** Visit order. */
  route: z.array(z.number().int()),
  assignments: z.array(
    z.object({
      itemId: z.string(),
      rawText: z.string(),
      productName: z.string(),
      storeId: z.number().int(),
      title: z.string(),
      packages: z.number().int().nullable(),
      lineCents: z.number().int(),
      baselineLineCents: z.number().int().nullable(),
    }),
  ),
  missing: z.array(z.object({ itemId: z.string(), rawText: z.string() })),
  complete: z.boolean(),
  itemsCents: z.number().int(),
  distanceMiles: z.number(),
  fuelCents: z.number().int(),
  timeCents: z.number().int(),
  /** items + fuel + time */
  totalCents: z.number().int(),
  baselineCents: z.number().int().nullable(),
  /** baseline − (items + fuel): what logging this plan as a trip records. */
  savingsVsBaselineCents: z.number().int().nullable(),
});
export type OptimizedPlan = z.infer<typeof OptimizedPlan>;

export const OptimizeResponse = z.object({
  listId: z.uuid(),
  listName: z.string(),
  asOf: z.string(),
  maxStores: z.number().int(),
  stores: z.array(CompareStoreInfo),
  baselineStore: z.object({ id: z.number().int(), name: z.string() }).nullable(),
  settings: z.object({
    mpg: z.number(),
    fuelCentsPerGal: z.number().int(),
    timeValueCentsPerHour: z.number().int(),
    minutesPerStop: z.number().int(),
    /** False when origin/mpg/fuel were overridden: a logged trip will be costed differently. */
    matchesTrip: z.boolean(),
  }),
  single: OptimizedPlan,
  multi: z.array(OptimizedPlan),
  recommendation: z.object({
    kind: z.enum(['single', 'multi']),
    reason: z.enum(['only_option', 'coverage', 'saves_enough', 'not_worth_it']),
    extraStopSavingsCents: z.number().int().nullable(),
    thresholdCents: z.number().int(),
  }),
  /** List items with no matching product (never priced). */
  unpriced: z.array(z.string()),
  subsetsEvaluated: z.number().int(),
});
export type OptimizeResponse = z.infer<typeof OptimizeResponse>;
