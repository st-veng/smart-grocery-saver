/**
 * Stateless, deterministic price model: price(item, date) depends only on (seed, anchor, item, date).
 * That makes history, "today" and future days (sim:advance) all consistent without stored state.
 */
import {
  dayOfWeek,
  formatCents,
  monthOf,
  packageBaseQuantity,
  rand01,
  randInt,
  randRange,
  toDayNumber,
  fromDayNumber,
  type IsoDate,
} from '@sgs/core';
import type { AisleSlug } from '../catalog/categories.js';
import type { ProductSpec } from '../catalog/products.js';
import { chainBySlug, type ChainSpec, type PromoProfile } from '../catalog/stores.js';
import type { ProviderPrice } from '../provider.js';
import { NATIONAL_BRAND_PREMIUM, referenceBase, type MockItem } from './assortment.js';

export interface PriceModelOptions {
  readonly seed: string;
  readonly anchorDate: IsoDate;
}

const DRIFT_PER_YEAR = 0.025;
const EGG_SHOCK = { startOffset: -200, days: 42, factor: 1.4 } as const;

/** Round to a retail "…9" ending, never below 9¢. */
export function roundEnding9(cents: number): number {
  return Math.max(9, Math.round((cents - 9) / 10) * 10 + 9);
}

function seasonalFactor(spec: ProductSpec, date: IsoDate): number {
  if (!spec.season) return 1;
  const [cheapMonth, amp] = spec.season;
  const day = Number(date.slice(8, 10));
  const m = monthOf(date) + (day - 1) / 30;
  return 1 - amp * Math.cos((2 * Math.PI * (m - cheapMonth)) / 12);
}

interface Epoch {
  readonly index: number;
  readonly startDay: number;
}

function epochOf(seed: string, item: MockItem, day: number): Epoch {
  const chain = chainBySlug(item.chain);
  const produce = item.product?.category === 'produce';
  const startDow = chain.promo?.cadence === 'weekly' ? (chain.promo.startDow ?? 3) : 3;
  if (produce) {
    // Weekly regular-price changes aligned to the chain's ad week.
    const offset = (((day + 4 - startDow) % 7) + 7) % 7;
    const startDay = day - offset;
    return { index: startDay, startDay };
  }
  const len = randInt(56, 91, seed, 'epochLen', item.chain, item.sku);
  const shift = randInt(0, len - 1, seed, 'epochShift', item.chain, item.sku);
  const index = Math.floor((day + shift) / len);
  return { index, startDay: index * len - shift };
}

export class PriceModel {
  private readonly anchorDay: number;

  constructor(private readonly opts: PriceModelOptions) {
    this.anchorDay = toDayNumber(opts.anchorDate);
  }

  /** Base quantity priced: package base, or one pricing unit (1 lb) for per-weight items. */
  pricedBase(item: MockItem): number {
    const s = item.truthSize;
    if (!s) throw new Error(`item ${item.sku} has no size`);
    return s.perWeight
      ? packageBaseQuantity(1, 1, s.unit)
      : packageBaseQuantity(s.packCount, s.unitQuantity, s.unit);
  }

  regularPrice(item: MockItem, date: IsoDate): number {
    const spec = item.product;
    if (!spec) return 499; // unmatchable extras: flat price
    const { seed } = this.opts;
    const chain = chainBySlug(item.chain);
    const day = toDayNumber(date);
    const epoch = epochOf(seed, item, day);
    const epochDate = fromDayNumber(epoch.startDay);
    const unitRef = spec.ref / referenceBase(spec);
    const jitter =
      item.chain === 'kroger' ? 1 : randRange(0.97, 1.03, seed, 'jitter', item.chain, spec.slug);
    const brand = item.isStoreBrand || item.brand === null ? 1 : NATIONAL_BRAND_PREMIUM;
    const drift = (1 + DRIFT_PER_YEAR) ** ((epoch.startDay - this.anchorDay) / 365);
    const wobble = randRange(0.985, 1.015, seed, 'wobble', item.chain, item.sku, epoch.index);
    const shockStart = this.anchorDay + EGG_SHOCK.startOffset;
    const shock =
      spec.eggShock && day >= shockStart && day < shockStart + EGG_SHOCK.days
        ? EGG_SHOCK.factor
        : 1;
    const unit =
      unitRef *
      chain.index(spec.category) *
      jitter *
      brand *
      drift *
      wobble *
      seasonalFactor(spec, epochDate) *
      shock;
    return roundEnding9(unit * this.pricedBase(item));
  }

  observe(item: MockItem, date: IsoDate): ProviderPrice {
    const regular = this.regularPrice(item, date);
    const chain = chainBySlug(item.chain);
    const promo =
      item.product && chain.promo ? this.bestPromo(item, chain, chain.promo, regular, date) : null;
    return {
      sku: item.sku,
      date,
      regularPriceCents: regular,
      salePriceCents: promo?.sale ?? null,
      promoType: promo?.type ?? 'none',
      promoLabel: promo?.label ?? null,
      minQty: promo?.minQty ?? 1,
      memberOnly: promo?.memberOnly ?? false,
    };
  }

  private bestPromo(
    item: MockItem,
    chain: ChainSpec,
    profile: PromoProfile,
    regular: number,
    date: IsoDate,
  ) {
    const day = toDayNumber(date);
    const windows: string[] = [];
    if (profile.cadence === 'weekly') {
      const startDow = profile.startDow ?? 3;
      const adDays = profile.adDays ?? 7;
      const offset = (((dayOfWeek(date) - startDow) % 7) + 7) % 7;
      const thisWeekStart = day - offset;
      windows.push(`w${thisWeekStart}`);
      // An 8-day ad overlaps the first day of the next ad (Sprouts' Wednesday double-ad day).
      if (adDays > 7 && offset < adDays - 7) windows.push(`w${thisWeekStart - 7}`);
    } else if (profile.cadence === 'monthly') {
      windows.push(`m${date.slice(0, 7)}`);
    } else {
      const len = profile.blockDays ?? 28;
      const shift = randInt(0, len - 1, this.opts.seed, 'blockShift', chain.slug);
      windows.push(`b${Math.floor((day + shift) / len)}`);
    }
    let best: {
      sale: number;
      type: 'sale' | 'member' | 'multi_buy';
      label: string;
      minQty: number;
      memberOnly: boolean;
    } | null = null;
    for (const w of windows) {
      const p = this.promoFor(item, chain, profile, regular, date, w);
      if (p && (best === null || p.sale < best.sale)) best = p;
    }
    return best;
  }

  private promoFor(
    item: MockItem,
    chain: ChainSpec,
    profile: PromoProfile,
    regular: number,
    date: IsoDate,
    window: string,
  ) {
    const spec = item.product;
    if (!spec) return null;
    const { seed } = this.opts;
    const category: AisleSlug = spec.category;
    let pItem = typeof profile.pItem === 'function' ? profile.pItem(category) : profile.pItem;
    let [dMin, dMax] = profile.depth;
    const month = monthOf(date);
    if (spec.promo === 'turkey' && month === 11) {
      pItem = 0.9;
      [dMin, dMax] = [0.4, 0.6];
    } else if (spec.promo === 'baking' && (month === 12 || month === 11)) pItem *= 3;
    else if (spec.promo === 'grilling' && month >= 5 && month <= 7) pItem *= 2.5;
    if (rand01(seed, 'promo', chain.slug, item.sku, window) >= Math.min(0.95, pItem)) return null;

    const depth = randRange(dMin, dMax, seed, 'depth', chain.slug, item.sku, window);
    let sale = roundEnding9(regular * (1 - depth));
    if (sale >= regular) sale = regular - 10;
    if (sale <= 0) return null;
    const memberOnly = rand01(seed, 'member', chain.slug, item.sku, window) < profile.memberShare;
    const multi =
      !memberOnly && rand01(seed, 'multi', chain.slug, item.sku, window) < profile.multiBuyShare;
    if (multi) {
      return {
        sale,
        type: 'multi_buy' as const,
        label: `2 for ${formatCents(sale * 2)}`,
        minQty: 2,
        memberOnly: false,
      };
    }
    return {
      sale,
      type: memberOnly ? ('member' as const) : ('sale' as const),
      label: memberOnly ? (profile.memberLabel ?? profile.label) : profile.label,
      minQty: 1,
      memberOnly,
    };
  }
}
