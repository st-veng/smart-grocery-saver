/**
 * Turning a comparison into a trip (SPEC Phase 6, savings definition Q-2). Pure: the API recomputes
 * the comparison at `price_as_of`, this picks each item's line among the plan's stores and pairs it
 * with the baseline store's line, so savings are always like-for-like on the items actually bought.
 */
import { CIRCUITY_FACTOR, haversineMiles, type LatLng } from '../geo.js';
import { roundHalfEven } from '../money.js';
import type { CompareResult } from '../pricing/compare.js';

export interface PlanItem {
  readonly itemId: string;
  readonly storeId: number;
  readonly storeItemId: string;
  readonly title: string;
  /** Whole packages bought; null for per-weight items. */
  readonly packages: number | null;
  /** Quantity bought in the product's base unit (g / ml / ea). */
  readonly boughtBase: number;
  readonly lineCents: number;
  readonly unitPriceCents: number;
  readonly onSale: boolean;
  readonly promoLabel: string | null;
  readonly approximate: boolean;
  readonly baselineStoreItemId: string;
  readonly baselineLineCents: number;
}

export type SkipReason = 'unpriced' | 'not_in_plan_stores' | 'not_at_baseline';

export interface TripPlan {
  /** Stores that got at least one item, in the order the caller listed them. */
  readonly storeIds: number[];
  readonly baselineStoreId: number;
  readonly items: PlanItem[];
  readonly skipped: { readonly itemId: string; readonly reason: SkipReason }[];
  readonly itemsCents: number;
  readonly baselineCents: number;
}

export class PlanError extends Error {
  constructor(
    readonly code: 'NO_BASELINE' | 'STORE_NOT_AVAILABLE' | 'NOTHING_TO_BUY',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Assign every priced item to its cheapest line among `storeIds` (ties → earlier store in
 * `storeIds`). Items the baseline store can't price are skipped on both sides, so the trip's
 * baseline total covers exactly the items bought.
 */
export function planFromComparison(result: CompareResult, storeIds: readonly number[]): TripPlan {
  const baselineStoreId = result.baseline.storeId;
  if (baselineStoreId === null) {
    throw new PlanError(
      'NO_BASELINE',
      'None of your stores carries every item, so there is no baseline to measure savings against',
    );
  }
  const available = new Set(result.stores.map((s) => s.storeId));
  for (const id of storeIds) {
    if (!available.has(id)) {
      throw new PlanError('STORE_NOT_AVAILABLE', `Store ${String(id)} is not one of your stores`);
    }
  }
  const rank = new Map(storeIds.map((id, i) => [id, i]));
  const items: PlanItem[] = [];
  const skipped: TripPlan['skipped'] = [];
  for (const line of result.lines) {
    if (line.unpriced || line.needBase === null) {
      skipped.push({ itemId: line.itemId, reason: 'unpriced' });
      continue;
    }
    const base = line.stores.find((s) => s.storeId === baselineStoreId);
    if (!base || base.status !== 'ok' || base.lineCents === null || base.storeItemId === null) {
      skipped.push({ itemId: line.itemId, reason: 'not_at_baseline' });
      continue;
    }
    let best: (typeof line.stores)[number] | undefined;
    for (const s of line.stores) {
      if (s.status !== 'ok' || s.lineCents === null || !rank.has(s.storeId)) continue;
      if (
        !best ||
        best.lineCents === null ||
        s.lineCents < best.lineCents ||
        (s.lineCents === best.lineCents &&
          (rank.get(s.storeId) ?? 0) < (rank.get(best.storeId) ?? 0))
      ) {
        best = s;
      }
    }
    if (
      !best ||
      best.lineCents === null ||
      best.storeItemId === null ||
      best.title === null ||
      best.unitPriceCents === null
    ) {
      skipped.push({ itemId: line.itemId, reason: 'not_in_plan_stores' });
      continue;
    }
    items.push({
      itemId: line.itemId,
      storeId: best.storeId,
      storeItemId: best.storeItemId,
      title: best.title,
      packages: best.packages,
      boughtBase: line.needBase + best.overbuyBase,
      lineCents: best.lineCents,
      unitPriceCents: best.unitPriceCents,
      onSale: best.onSale,
      promoLabel: best.promoLabel,
      approximate: best.approximate || line.needApproximate,
      baselineStoreItemId: base.storeItemId,
      baselineLineCents: base.lineCents,
    });
  }
  if (items.length === 0) {
    throw new PlanError('NOTHING_TO_BUY', 'None of the items can be bought at these stores');
  }
  const used = new Set(items.map((i) => i.storeId));
  return {
    storeIds: storeIds.filter((id) => used.has(id)),
    baselineStoreId,
    items,
    skipped,
    itemsCents: items.reduce((t, i) => t + i.lineCents, 0),
    baselineCents: items.reduce((t, i) => t + i.baselineLineCents, 0),
  };
}

export interface RouteStop {
  readonly id: number;
  readonly at: LatLng;
}

/** Road-distance estimate for one leg (SPEC A-9). */
export const roadMiles = (a: LatLng, b: LatLng): number => haversineMiles(a, b) * CIRCUITY_FACTOR;

function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [xs.slice()];
  return xs.flatMap((x, i) =>
    permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]),
  );
}

/**
 * Shortest round trip home → every stop → home, by brute force (≤ 6 stops; plans use ≤ 3).
 * Ties keep the first permutation in input order, so the result is deterministic.
 */
export function bestRoute(
  home: LatLng,
  stops: readonly RouteStop[],
): { order: number[]; miles: number } {
  if (stops.length === 0) return { order: [], miles: 0 };
  if (stops.length > 6) throw new RangeError('bestRoute supports at most 6 stops');
  let best: { order: number[]; miles: number } | null = null;
  for (const p of permutations(stops)) {
    let miles = 0;
    let at = home;
    for (const s of p) {
      miles += roadMiles(at, s.at);
      at = s.at;
    }
    miles += roadMiles(at, home);
    if (!best || miles < best.miles - 1e-9) best = { order: p.map((s) => s.id), miles };
  }
  // Non-null: stops is non-empty so the loop ran at least once.
  const r = best ?? { order: [], miles: 0 };
  return { order: r.order, miles: Math.round(r.miles * 100) / 100 };
}

/** Fuel for `miles` at `mpg` and `centsPerGallon`, rounded half-even once. */
export function fuelCostCents(miles: number, mpg: number, centsPerGallon: number): number {
  if (!(mpg > 0)) throw new RangeError('mpg must be positive');
  return roundHalfEven((miles / mpg) * centsPerGallon);
}
