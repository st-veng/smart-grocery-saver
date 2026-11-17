/**
 * List price comparison (SPEC §2.2–2.3, Phase 4). Pure: the API loads offers at `asOf` and the
 * user's store settings, this computes line costs, store totals, the cheapest store and savings.
 */
import { bridgeBase, dimensionOf, toBase } from '../units/convert.js';
import type { Dimension, UnitCode } from '../units/table.js';
import { coverCost, type CoverOption, type PricingBasis } from './cover-cost.js';
import { unitPriceCents } from './unit-price.js';

export interface CompareStore {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly requiresMembership: boolean;
  readonly loyaltyProgram: string | null;
}

export interface StoreSettings {
  readonly enabled: boolean;
  readonly hasMembership: boolean;
  readonly hasLoyalty: boolean;
}

export interface CompareProduct {
  readonly id: string;
  readonly name: string;
  readonly dimension: Dimension;
  readonly displayUnit: UnitCode;
  readonly defaultQuantity: number;
  readonly defaultUnit: UnitCode;
  readonly avgEachGrams: number | null;
}

/** A store item and its price period at `asOf`. */
export interface Offer {
  readonly storeItemId: string;
  readonly storeId: number;
  readonly productId: string;
  readonly title: string;
  readonly brand: string | null;
  readonly isStoreBrand: boolean;
  readonly basis: PricingBasis;
  /** Base quantity of the package (or of one pricing unit for per_weight), in the item's own unit dimension. */
  readonly baseQuantity: number;
  readonly unit: UnitCode;
  readonly regularPriceCents: number;
  readonly salePriceCents: number | null;
  readonly promoLabel: string | null;
  readonly minQty: number;
  readonly memberOnly: boolean;
}

export interface CompareLine {
  readonly itemId: string;
  readonly product: CompareProduct | null;
  readonly quantity: number;
  readonly unit: UnitCode | null;
  readonly matchMode: 'any' | 'brand' | 'exact_item';
  readonly brand: string | null;
  readonly storeItemId: string | null;
}

export type ExclusionReason = 'disabled' | 'no_membership' | 'not_selected';

export interface LineAtStore {
  readonly storeId: number;
  readonly status: 'ok' | 'missing';
  readonly storeItemId: string | null;
  readonly title: string | null;
  readonly brand: string | null;
  /** Whole packages bought; null for per-weight items. */
  readonly packages: number | null;
  readonly lineCents: number | null;
  /** Price per product display unit for the chosen item (unrounded cents). */
  readonly unitPriceCents: number | null;
  readonly onSale: boolean;
  readonly memberPrice: boolean;
  readonly promoLabel: string | null;
  readonly usedMultiBuy: boolean;
  /** Count↔weight conversion was needed (average weight), so the comparison is approximate. */
  readonly approximate: boolean;
  /** Bought minus needed, in the product's base unit (g / ml / ea). */
  readonly overbuyBase: number;
}

export interface LineResult {
  readonly itemId: string;
  /** No product matched: shown but never priced. */
  readonly unpriced: boolean;
  readonly needBase: number | null;
  readonly needApproximate: boolean;
  readonly stores: LineAtStore[];
  readonly cheapestStoreIds: number[];
}

export interface StoreTotal {
  readonly storeId: number;
  readonly totalCents: number;
  readonly pricedCount: number;
  readonly missingCount: number;
  readonly complete: boolean;
  /** vs the baseline store, only when both are complete. */
  readonly savingsCents: number | null;
  readonly savingsPct: number | null;
}

export interface CompareResult {
  readonly lines: LineResult[];
  readonly stores: StoreTotal[];
  readonly excluded: { readonly storeId: number; readonly reason: ExclusionReason }[];
  /** Cheapest store that carries every priced item; null if none does. */
  readonly cheapestStoreId: number | null;
  /** Fewest missing items, then lowest total — for "cheapest with N missing". */
  readonly cheapestWithMissingStoreId: number | null;
  readonly baseline: {
    readonly storeId: number | null;
    readonly source: 'user' | 'median' | 'none';
    readonly totalCents: number | null;
  };
  /** Cheapest complete store vs baseline, one decimal; null when not comparable. */
  readonly savingsPct: number | null;
  readonly savingsCents: number | null;
  readonly unpricedCount: number;
}

export interface CompareInput {
  readonly lines: readonly CompareLine[];
  readonly stores: readonly CompareStore[];
  readonly settings: ReadonlyMap<number, StoreSettings>;
  readonly offers: readonly Offer[];
  readonly baselineStoreId: number | null;
  /** Restrict to these eligible stores (UI toggles). Undefined = all eligible. */
  readonly onlyStoreIds?: readonly number[] | undefined;
}

/** Does this user get the member/loyalty price at this store? (SPEC §2.3) */
export function qualifiesForMemberPrice(store: CompareStore, s: StoreSettings): boolean {
  if (store.requiresMembership) return s.hasMembership;
  if (store.loyaltyProgram !== null) return s.hasLoyalty;
  return false;
}

/** The price this user pays for an offer: sale price unless it is member-only and they don't qualify. */
export function effectivePrice(
  offer: Offer,
  store: CompareStore,
  s: StoreSettings,
): {
  priceCents: number;
  onSale: boolean;
  memberPrice: boolean;
  promoLabel: string | null;
  minQty: number;
} {
  const sale = offer.salePriceCents;
  if (sale === null || (offer.memberOnly && !qualifiesForMemberPrice(store, s))) {
    return {
      priceCents: offer.regularPriceCents,
      onSale: false,
      memberPrice: false,
      promoLabel: null,
      minQty: 1,
    };
  }
  return {
    priceCents: sale,
    onSale: true,
    memberPrice: offer.memberOnly,
    promoLabel: offer.promoLabel,
    minQty: offer.minQty,
  };
}

/** Stores the user can shop at: enabled, and a membership if the club requires one (Q-3). */
export function eligibleStores(
  stores: readonly CompareStore[],
  settings: ReadonlyMap<number, StoreSettings>,
  only?: readonly number[],
): { included: CompareStore[]; excluded: { storeId: number; reason: ExclusionReason }[] } {
  const included: CompareStore[] = [];
  const excluded: { storeId: number; reason: ExclusionReason }[] = [];
  for (const st of [...stores].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)) {
    const s = settings.get(st.id);
    if (!s?.enabled) excluded.push({ storeId: st.id, reason: 'disabled' });
    else if (st.requiresMembership && !s.hasMembership)
      excluded.push({ storeId: st.id, reason: 'no_membership' });
    else if (only && !only.includes(st.id))
      excluded.push({ storeId: st.id, reason: 'not_selected' });
    else included.push(st);
  }
  return { included, excluded };
}

/** Requested quantity in the product's base unit; approximate when a count↔mass bridge was used. */
export function needInProductBase(
  line: CompareLine,
  p: CompareProduct,
): { base: number; approximate: boolean } | null {
  const unit = line.unit ?? p.defaultUnit;
  const qty = line.unit ? line.quantity : line.quantity * p.defaultQuantity;
  const b = bridgeBase(toBase(qty, unit), dimensionOf(unit), p.dimension, p.avgEachGrams);
  return b ? { base: b.baseQuantity, approximate: b.approximate } : null;
}

function offerMatches(line: CompareLine, o: Offer): boolean {
  if (line.matchMode === 'exact_item') return o.storeItemId === line.storeItemId;
  if (line.matchMode === 'brand')
    return (o.brand ?? '').trim().toLowerCase() === (line.brand ?? '').trim().toLowerCase();
  return true;
}

function priceLineAtStore(
  line: CompareLine,
  p: CompareProduct,
  need: { base: number; approximate: boolean },
  store: CompareStore,
  s: StoreSettings,
  offers: readonly Offer[],
): LineAtStore {
  const options: (CoverOption & {
    offer: Offer;
    approx: boolean;
    eff: ReturnType<typeof effectivePrice>;
  })[] = [];
  // Deterministic tie-break: coverCost breaks exact ties by option id, so ids follow a stable content
  // order (title, then store item id) instead of random UUIDs that differ between databases.
  const ordered = [...offers].sort(
    (a, b) => a.title.localeCompare(b.title) || a.storeItemId.localeCompare(b.storeItemId),
  );
  for (const [rank, o] of ordered.entries()) {
    if (!offerMatches(line, o)) continue;
    // Express the package in the product's dimension (count↔mass via average weight).
    const b = bridgeBase(o.baseQuantity, dimensionOf(o.unit), p.dimension, p.avgEachGrams);
    if (!b || !(b.baseQuantity > 0)) continue;
    const eff = effectivePrice(o, store, s);
    options.push({
      id: String(rank).padStart(6, '0'),
      basis: o.basis,
      baseQuantity: b.baseQuantity,
      priceCents: eff.priceCents,
      regularPriceCents: o.regularPriceCents,
      minQty: eff.minQty,
      offer: o,
      approx: b.approximate,
      eff,
    });
  }
  const best = coverCost(need.base, options);
  const chosen = best ? options.find((o) => o.id === best.optionId) : undefined;
  if (!best || !chosen) {
    return {
      storeId: store.id,
      status: 'missing',
      storeItemId: null,
      title: null,
      brand: null,
      packages: null,
      lineCents: null,
      unitPriceCents: null,
      onSale: false,
      memberPrice: false,
      promoLabel: null,
      usedMultiBuy: false,
      approximate: false,
      overbuyBase: 0,
    };
  }
  // Multi-buy priced below its minimum falls back to regular, so the "sale" flags follow what was paid.
  const paidSale = chosen.eff.onSale && (chosen.eff.minQty <= 1 || best.usedMultiBuy);
  const paidUnitPrice = paidSale ? chosen.eff.priceCents : chosen.offer.regularPriceCents;
  return {
    storeId: store.id,
    status: 'ok',
    storeItemId: chosen.offer.storeItemId,
    title: chosen.offer.title,
    brand: chosen.offer.brand,
    packages: best.packages,
    lineCents: best.costCents,
    unitPriceCents: unitPriceCents(paidUnitPrice, chosen.baseQuantity, p.displayUnit),
    onSale: paidSale,
    memberPrice: paidSale && chosen.eff.memberPrice,
    promoLabel: paidSale ? chosen.eff.promoLabel : null,
    usedMultiBuy: best.usedMultiBuy,
    approximate: chosen.approx || need.approximate,
    overbuyBase: best.overbuyBase,
  };
}

const pct = (saved: number, base: number) => Math.round((saved / base) * 1000) / 10;

export function compareList(input: CompareInput): CompareResult {
  const { included, excluded } = eligibleStores(input.stores, input.settings, input.onlyStoreIds);
  const offersBy = new Map<string, Offer[]>();
  for (const o of input.offers) {
    const k = `${o.productId}|${String(o.storeId)}`;
    const list = offersBy.get(k) ?? [];
    list.push(o);
    offersBy.set(k, list);
  }

  const lines: LineResult[] = input.lines.map((line) => {
    const p = line.product;
    const need = p ? needInProductBase(line, p) : null;
    if (!p || !need) {
      return {
        itemId: line.itemId,
        unpriced: true,
        needBase: null,
        needApproximate: false,
        stores: [],
        cheapestStoreIds: [],
      };
    }
    const stores = included.map((st) => {
      const s = input.settings.get(st.id) ?? {
        enabled: true,
        hasMembership: false,
        hasLoyalty: false,
      };
      return priceLineAtStore(line, p, need, st, s, offersBy.get(`${p.id}|${String(st.id)}`) ?? []);
    });
    const priced = stores.filter((x) => x.lineCents !== null);
    const min = priced.length ? Math.min(...priced.map((x) => x.lineCents ?? Infinity)) : null;
    return {
      itemId: line.itemId,
      unpriced: false,
      needBase: need.base,
      needApproximate: need.approximate,
      stores,
      cheapestStoreIds:
        min === null ? [] : priced.filter((x) => x.lineCents === min).map((x) => x.storeId),
    };
  });

  const pricedLines = lines.filter((l) => !l.unpriced);
  const rawTotals = included.map((st) => {
    let total = 0;
    let missing = 0;
    for (const l of pricedLines) {
      const at = l.stores.find((x) => x.storeId === st.id);
      if (at?.lineCents == null) missing++;
      else total += at.lineCents;
    }
    return { store: st, totalCents: total, missingCount: missing, complete: missing === 0 };
  });

  const complete = rawTotals.filter((t) => t.complete && pricedLines.length > 0);
  const byTotal = (a: (typeof rawTotals)[number], b: (typeof rawTotals)[number]) =>
    a.totalCents - b.totalCents || a.store.sortOrder - b.store.sortOrder || a.store.id - b.store.id;
  const cheapest = [...complete].sort(byTotal)[0] ?? null;
  const withMissing =
    [...rawTotals]
      .filter(() => pricedLines.length > 0)
      .sort((a, b) => a.missingCount - b.missingCount || byTotal(a, b))[0] ?? null;

  // Baseline (Q-2): the user's usual store when it is included and complete; else the median complete store.
  let baseline: CompareResult['baseline'] = { storeId: null, source: 'none', totalCents: null };
  const userBase = complete.find((t) => t.store.id === input.baselineStoreId);
  if (userBase)
    baseline = { storeId: userBase.store.id, source: 'user', totalCents: userBase.totalCents };
  else if (complete.length > 0) {
    const sorted = [...complete].sort(byTotal);
    const med = sorted[Math.floor((sorted.length - 1) / 2)];
    if (med) baseline = { storeId: med.store.id, source: 'median', totalCents: med.totalCents };
  }

  const stores: StoreTotal[] = rawTotals.map((t) => {
    const comparable =
      baseline.totalCents !== null &&
      baseline.totalCents > 0 &&
      t.complete &&
      pricedLines.length > 0;
    const saved = comparable ? (baseline.totalCents ?? 0) - t.totalCents : null;
    return {
      storeId: t.store.id,
      totalCents: t.totalCents,
      pricedCount: pricedLines.length - t.missingCount,
      missingCount: t.missingCount,
      complete: t.complete && pricedLines.length > 0,
      savingsCents: saved,
      savingsPct: saved === null ? null : pct(saved, baseline.totalCents ?? 1),
    };
  });

  const best = cheapest ? stores.find((s) => s.storeId === cheapest.store.id) : undefined;
  return {
    lines,
    stores,
    excluded,
    cheapestStoreId: cheapest?.store.id ?? null,
    cheapestWithMissingStoreId: withMissing?.store.id ?? null,
    baseline,
    savingsPct: best?.savingsPct ?? null,
    savingsCents: best?.savingsCents ?? null,
    unpricedCount: lines.length - pricedLines.length,
  };
}
