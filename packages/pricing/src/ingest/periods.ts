/** Pure price-period logic (SPEC §2.5): observations → contiguous [from, to) periods. */
import { addDays, diffDays, type IsoDate } from '@sgs/core';
import type { PromoType, ProviderPrice } from '../provider.js';

export interface PriceAttrs {
  readonly regularPriceCents: number;
  readonly salePriceCents: number | null;
  readonly promoType: PromoType;
  readonly promoLabel: string | null;
  readonly minQty: number;
  readonly memberOnly: boolean;
}

export interface Period extends PriceAttrs {
  readonly from: IsoDate;
  /** Exclusive end; null = open (current price). */
  readonly to: IsoDate | null;
}

export function attrsOf(p: PriceAttrs): PriceAttrs {
  return {
    regularPriceCents: p.regularPriceCents,
    salePriceCents: p.salePriceCents,
    promoType: p.promoType,
    promoLabel: p.promoLabel,
    minQty: p.minQty,
    memberOnly: p.memberOnly,
  };
}

export function samePrice(a: PriceAttrs, b: PriceAttrs): boolean {
  return (
    a.regularPriceCents === b.regularPriceCents &&
    a.salePriceCents === b.salePriceCents &&
    a.promoType === b.promoType &&
    a.promoLabel === b.promoLabel &&
    a.minQty === b.minQty &&
    a.memberOnly === b.memberOnly
  );
}

/**
 * Merge daily observations (must be sorted and contiguous, one per day) into periods.
 * With `openEnded`, the last period has no end (it is the current price).
 */
export function observationsToPeriods(obs: readonly ProviderPrice[], openEnded: boolean): Period[] {
  const out: Period[] = [];
  let cur: { from: IsoDate; attrs: PriceAttrs } | null = null;
  let prev: IsoDate | null = null;
  for (const o of obs) {
    if (prev !== null && diffDays(o.date, prev) !== 1) {
      throw new RangeError(`observations not contiguous: ${prev} → ${o.date}`);
    }
    const attrs = attrsOf(o);
    if (cur === null) cur = { from: o.date, attrs };
    else if (!samePrice(cur.attrs, attrs)) {
      out.push({ ...cur.attrs, from: cur.from, to: o.date });
      cur = { from: o.date, attrs };
    }
    prev = o.date;
  }
  if (cur !== null && prev !== null)
    out.push({ ...cur.attrs, from: cur.from, to: openEnded ? null : addDays(prev, 1) });
  return out;
}

export function rangeLiteral(p: { from: IsoDate; to: IsoDate | null }): string {
  return `[${p.from},${p.to ?? ''})`;
}

export type ApplyAction =
  | { readonly kind: 'open'; readonly period: Period }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'replace'; readonly period: Period }
  | { readonly kind: 'close-and-open'; readonly closeAt: IsoDate; readonly period: Period }
  | { readonly kind: 'stale' };

/** Decide how a new daily observation changes the item's open (current) period. */
export function applyObservation(open: Period | null, obs: ProviderPrice): ApplyAction {
  const period: Period = { ...attrsOf(obs), from: obs.date, to: null };
  if (open === null) return { kind: 'open', period };
  if (diffDays(obs.date, open.from) < 0) return { kind: 'stale' };
  if (samePrice(open, obs)) return { kind: 'unchanged' };
  if (obs.date === open.from) return { kind: 'replace', period };
  return { kind: 'close-and-open', closeAt: obs.date, period };
}
