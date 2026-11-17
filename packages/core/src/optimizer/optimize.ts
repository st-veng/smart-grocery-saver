/**
 * Single- vs multi-store optimizer (SPEC §5 "Optimizer algorithm", Phase 7). Pure and exact:
 * 1. every subset S of the routable eligible stores with |S| ≤ maxStores,
 * 2. each priced item goes to its cheapest line in S (items are independent once S is fixed;
 *    ties → lower store id, which is what a committed trip does when given ascending store ids),
 * 3. the shortest round trip home → S → home by brute force (core `bestRoute`),
 * 4. total = items + fuel + time. Plans that miss fewer items rank first, then by total.
 * A subset whose cheapest assignment leaves one of its stores unused is the same plan as the
 * smaller subset, so it is skipped (the smaller subset is enumerated too).
 */
import type { LatLng } from '../geo.js';
import { roundHalfEven } from '../money.js';
import type { CompareResult } from '../pricing/compare.js';
import { bestRoute, fuelCostCents } from '../trips/plan.js';

/** Average driving speed for the optional time cost (SPEC A-10). */
export const DRIVING_MPH = 30;
export const DEFAULT_MINUTES_PER_STOP = 10;
/** Q-4: an extra stop is recommended only if it saves at least max($3, 3%) after fuel and time. */
export const MULTI_MIN_SAVING_CENTS = 300;
export const MULTI_MIN_SAVING_PCT = 3;

export interface OptimizeOptions {
  readonly maxStores: number;
  readonly home: LatLng;
  /** Stop location per store (preferred or nearest). Stores without one can't be routed. */
  readonly locations: ReadonlyMap<number, LatLng>;
  readonly mpg: number;
  readonly fuelCentsPerGal: number;
  /** 0 = time is free (the default, Q-4). */
  readonly timeValueCentsPerHour: number;
  readonly minutesPerStop: number;
}

export interface PlanAssignment {
  readonly itemId: string;
  readonly storeId: number;
  readonly lineCents: number;
  /** Same item at the baseline store; null without a baseline. */
  readonly baselineLineCents: number | null;
}

export interface OptimizedPlan {
  /** Stores that get at least one item, ascending. */
  readonly storeIds: number[];
  /** Visit order. */
  readonly route: number[];
  readonly assignments: PlanAssignment[];
  /** Priced items none of these stores carries. */
  readonly missing: string[];
  readonly complete: boolean;
  readonly itemsCents: number;
  readonly distanceMiles: number;
  readonly fuelCents: number;
  readonly timeCents: number;
  /** items + fuel + time */
  readonly totalCents: number;
  /** Baseline store's price for the assigned items (like-for-like); null without a baseline. */
  readonly baselineCents: number | null;
  /**
   * baseline − (items + fuel): exactly what committing this plan as a trip records. Time is a
   * ranking cost only, so it is not deducted here.
   */
  readonly savingsVsBaselineCents: number | null;
}

export interface Recommendation {
  readonly kind: 'single' | 'multi';
  readonly reason: 'only_option' | 'coverage' | 'saves_enough' | 'not_worth_it';
  /** best single total − best multi total (positive = the extra stop saves money). */
  readonly extraStopSavingsCents: number | null;
  readonly thresholdCents: number;
}

export interface OptimizeResult {
  readonly single: OptimizedPlan;
  /** Best multi-store plans, best first (at most 3). */
  readonly multi: OptimizedPlan[];
  readonly recommendation: Recommendation;
  readonly subsetsEvaluated: number;
}

function* subsets(
  ids: readonly number[],
  max: number,
  start = 0,
  acc: number[] = [],
): Generator<number[]> {
  if (acc.length > 0) yield acc.slice();
  if (acc.length === max) return;
  for (let i = start; i < ids.length; i++) {
    const id = ids[i];
    if (id === undefined) continue;
    acc.push(id);
    yield* subsets(ids, max, i + 1, acc);
    acc.pop();
  }
}

/** Rank: fewer missing items, then lower total, then fewer stores, then store ids. */
export function comparePlans(a: OptimizedPlan, b: OptimizedPlan): number {
  return (
    a.missing.length - b.missing.length ||
    a.totalCents - b.totalCents ||
    a.storeIds.length - b.storeIds.length ||
    a.storeIds.join(',').localeCompare(b.storeIds.join(','))
  );
}

export function multiThresholdCents(singleTotalCents: number): number {
  return Math.max(
    MULTI_MIN_SAVING_CENTS,
    roundHalfEven((singleTotalCents * MULTI_MIN_SAVING_PCT) / 100),
  );
}

/** The Q-4 rule, on its own so its boundaries are easy to test. */
export function recommend(single: OptimizedPlan, multi: OptimizedPlan | undefined): Recommendation {
  const thresholdCents = multiThresholdCents(single.totalCents);
  if (!multi) {
    return { kind: 'single', reason: 'only_option', extraStopSavingsCents: null, thresholdCents };
  }
  const extra = single.totalCents - multi.totalCents;
  if (multi.missing.length < single.missing.length) {
    return { kind: 'multi', reason: 'coverage', extraStopSavingsCents: extra, thresholdCents };
  }
  if (multi.missing.length === single.missing.length && extra >= thresholdCents) {
    return { kind: 'multi', reason: 'saves_enough', extraStopSavingsCents: extra, thresholdCents };
  }
  return { kind: 'single', reason: 'not_worth_it', extraStopSavingsCents: extra, thresholdCents };
}

export function optimize(result: CompareResult, opts: OptimizeOptions): OptimizeResult {
  if (!Number.isInteger(opts.maxStores) || opts.maxStores < 1 || opts.maxStores > 4) {
    throw new RangeError('maxStores must be 1–4');
  }
  const storeIds = result.stores
    .map((s) => s.storeId)
    .filter((id) => opts.locations.has(id))
    .sort((a, b) => a - b);
  const baselineId = result.baseline.storeId;
  const priced = result.lines.filter((l) => !l.unpriced && l.needBase !== null);
  // Per item: ok line cents by store, and the baseline line.
  const table = priced.map((l) => {
    const at = new Map<number, number>();
    for (const s of l.stores)
      if (s.status === 'ok' && s.lineCents !== null) at.set(s.storeId, s.lineCents);
    const base = baselineId === null ? null : (at.get(baselineId) ?? null);
    return { itemId: l.itemId, at, base };
  });

  const build = (subset: readonly number[]): OptimizedPlan | null => {
    const assignments: PlanAssignment[] = [];
    const missing: string[] = [];
    for (const row of table) {
      let best: { storeId: number; cents: number } | null = null;
      for (const id of subset) {
        const c = row.at.get(id);
        if (c !== undefined && (best === null || c < best.cents)) best = { storeId: id, cents: c };
      }
      if (best === null) missing.push(row.itemId);
      else
        assignments.push({
          itemId: row.itemId,
          storeId: best.storeId,
          lineCents: best.cents,
          baselineLineCents: row.base,
        });
    }
    const used = [...new Set(assignments.map((a) => a.storeId))].sort((a, b) => a - b);
    if (used.length !== subset.length) return null; // same as the smaller subset `used`
    return finish(used, assignments, missing);
  };

  const finish = (
    used: number[],
    assignments: PlanAssignment[],
    missing: string[],
  ): OptimizedPlan => {
    const route = bestRoute(
      opts.home,
      used.map((id) => ({ id, at: opts.locations.get(id) ?? opts.home })),
    );
    const itemsCents = assignments.reduce((t, a) => t + a.lineCents, 0);
    const fuelCents = fuelCostCents(route.miles, opts.mpg, opts.fuelCentsPerGal);
    const hours = (used.length * opts.minutesPerStop) / 60 + route.miles / DRIVING_MPH;
    const timeCents = roundHalfEven(opts.timeValueCentsPerHour * hours);
    const baselineCents =
      baselineId === null ? null : assignments.reduce((t, a) => t + (a.baselineLineCents ?? 0), 0);
    return {
      storeIds: used,
      route: route.order,
      assignments,
      missing,
      complete: missing.length === 0,
      itemsCents,
      distanceMiles: route.miles,
      fuelCents,
      timeCents,
      totalCents: itemsCents + fuelCents + timeCents,
      baselineCents,
      savingsVsBaselineCents:
        baselineCents === null ? null : baselineCents - itemsCents - fuelCents,
    };
  };

  const plans: OptimizedPlan[] = [];
  let subsetsEvaluated = 0;
  for (const s of subsets(storeIds, opts.maxStores)) {
    subsetsEvaluated++;
    const p = build(s);
    if (p) plans.push(p);
  }
  plans.sort(comparePlans);
  // Nothing to buy (or nowhere to buy it): the empty plan costs $0 and goes nowhere.
  const single =
    plans.find((p) => p.storeIds.length === 1) ??
    finish(
      [],
      [],
      table.map((r) => r.itemId),
    );
  const multi = plans.filter((p) => p.storeIds.length > 1).slice(0, 3);
  return { single, multi, recommendation: recommend(single, multi[0]), subsetsEvaluated };
}
