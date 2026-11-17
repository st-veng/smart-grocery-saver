/**
 * Price history (SPEC Phase 5): step series, historic lows and alert decisions. Pure functions over
 * price periods that the caller has already converted to unit prices.
 */
import { addDays, diffDays, type IsoDate } from '../dates.js';
import { bridgeBase, dimensionOf } from '../units/convert.js';
import type { Dimension, UnitCode } from '../units/table.js';
import { effectivePrice, type CompareStore, type Offer, type StoreSettings } from './compare.js';
import { unitPriceCents } from './unit-price.js';

/** A price period as a unit price: [from, to) with to = null meaning "still current". */
export interface UnitPricePeriod {
  readonly from: IsoDate;
  readonly to: IsoDate | null;
  readonly unitPriceCents: number;
  /** Identifies the source price point (for alert de-duplication). */
  readonly pricePointId: number;
}

export interface DateRange {
  /** Inclusive. */
  readonly from: IsoDate;
  /** Inclusive. */
  readonly to: IsoDate;
}

export interface StepPoint {
  readonly date: IsoDate;
  /** Lowest unit price that day, or null when nothing was on sale/available. */
  readonly unitPriceCents: number | null;
}

const covers = (p: UnitPricePeriod, d: IsoDate) =>
  diffDays(d, p.from) >= 0 && (p.to === null || diffDays(p.to, d) > 0);
const overlaps = (p: UnitPricePeriod, r: DateRange) =>
  diffDays(r.to, p.from) >= 0 && (p.to === null || diffDays(p.to, r.from) > 0);

/** Lowest unit price on day `d` across the periods (several store items of one store), or null. */
export function lowestOn(periods: readonly UnitPricePeriod[], d: IsoDate): number | null {
  let best: number | null = null;
  for (const p of periods)
    if (covers(p, d) && (best === null || p.unitPriceCents < best)) best = p.unitPriceCents;
  return best;
}

/**
 * Step series of the daily lowest unit price, clipped to `range`: one point at the start of the range
 * and one wherever the value changes. Charts render it as a step-after line.
 */
export function stepSeries(periods: readonly UnitPricePeriod[], range: DateRange): StepPoint[] {
  const inRange = periods.filter((p) => overlaps(p, range));
  const boundaries = new Set<IsoDate>([range.from]);
  for (const p of inRange) {
    if (diffDays(p.from, range.from) > 0) boundaries.add(p.from);
    if (p.to !== null && diffDays(p.to, range.from) > 0 && diffDays(range.to, p.to) >= 0)
      boundaries.add(p.to);
  }
  const out: StepPoint[] = [];
  for (const d of [...boundaries].sort()) {
    const v = lowestOn(inRange, d);
    const last = out.at(-1);
    if (!last || last.unitPriceCents !== v) out.push({ date: d, unitPriceCents: v });
  }
  return out;
}

export interface Low {
  readonly unitPriceCents: number;
  /** First day in the window at this price. */
  readonly date: IsoDate;
  readonly pricePointId: number;
}

/** Lowest unit price at any time within `window` (inclusive), or null. Ties → earliest date. */
export function lowestIn(periods: readonly UnitPricePeriod[], window: DateRange): Low | null {
  let best: Low | null = null;
  for (const p of periods) {
    if (!overlaps(p, window)) continue;
    const date = diffDays(p.from, window.from) > 0 ? p.from : window.from;
    if (
      best === null ||
      p.unitPriceCents < best.unitPriceCents ||
      (p.unitPriceCents === best.unitPriceCents && diffDays(date, best.date) < 0)
    ) {
      best = { unitPriceCents: p.unitPriceCents, date, pricePointId: p.pricePointId };
    }
  }
  return best;
}

/** The 365-day window ending on `asOf` (inclusive). */
export const yearEndingOn = (asOf: IsoDate): DateRange => ({ from: addDays(asOf, -364), to: asOf });

/** The 365 days before `asOf` (excluding it) — what a new price must beat to be a historic low. */
export const yearBefore = (asOf: IsoDate): DateRange => ({
  from: addDays(asOf, -365),
  to: addDays(asOf, -1),
});

export type AlertKind = 'historic_low' | 'target_price';

/**
 * Should an alert fire for today's price? (Q-7 default.) A historic low must be STRICTLY below the
 * prior 365-day low; a tie does not count. A target-price alert fires at or below the target, both in
 * the product's display unit.
 */
export function shouldTrigger(
  kind: AlertKind,
  current: number | null,
  priorLow: number | null,
  targetCents: number | null,
): boolean {
  if (current === null) return false;
  const EPS = 1e-9;
  if (kind === 'historic_low') return priorLow !== null && current < priorLow - EPS;
  return targetCents !== null && current <= targetCents + EPS;
}

export interface UnitPriceProduct {
  readonly dimension: Dimension;
  readonly displayUnit: UnitCode;
  readonly avgEachGrams: number | null;
}

/**
 * What one package of an offer costs this user per display unit. A multi-buy price needs several
 * packages, so a single package is valued at its regular price. Null when the units can't be compared.
 */
export function offerUnitPrice(
  offer: Offer,
  product: UnitPriceProduct,
  store: CompareStore,
  settings: StoreSettings,
): { unitPriceCents: number; approximate: boolean; priceCents: number; onSale: boolean } | null {
  const b = bridgeBase(
    offer.baseQuantity,
    dimensionOf(offer.unit),
    product.dimension,
    product.avgEachGrams,
  );
  if (!b || !(b.baseQuantity > 0)) return null;
  const eff = effectivePrice(offer, store, settings);
  const each = eff.minQty > 1 ? offer.regularPriceCents : eff.priceCents;
  return {
    unitPriceCents: unitPriceCents(each, b.baseQuantity, product.displayUnit),
    approximate: b.approximate,
    priceCents: each,
    onSale: eff.onSale && eff.minQty <= 1,
  };
}
