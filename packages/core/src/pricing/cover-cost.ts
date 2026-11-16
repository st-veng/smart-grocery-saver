import { roundHalfEven } from '../money.js';

export type PricingBasis = 'per_package' | 'per_weight';

export interface CoverOption {
  readonly id: string;
  readonly basis: PricingBasis;
  /** Package size in base units; for per_weight, base units of one pricing unit (1 lb = 453.59237 g). */
  readonly baseQuantity: number;
  /** Effective (possibly sale) price per package, or per pricing unit for per_weight. */
  readonly priceCents: number;
  /** Regular price; charged when a multi-buy minimum is not met. Defaults to priceCents. */
  readonly regularPriceCents?: number;
  /** Multi-buy minimum ("2 for $5" → 2). The sale price needs at least this many packages. */
  readonly minQty?: number;
}

export interface CoverResult {
  readonly optionId: string;
  /** Whole packages bought; null for per_weight. */
  readonly packages: number | null;
  readonly costCents: number;
  readonly boughtBase: number;
  readonly overbuyBase: number;
  /** True if a multi-buy deal was used (possibly by buying extra to reach its minimum). */
  readonly usedMultiBuy: boolean;
}

const EPS = 1e-9;

function evaluate(needBase: number, o: CoverOption): CoverResult {
  if (!(o.baseQuantity > 0)) throw new RangeError(`option ${o.id}: baseQuantity must be > 0`);
  if (o.basis === 'per_weight') {
    return {
      optionId: o.id,
      packages: null,
      costCents: roundHalfEven((needBase / o.baseQuantity) * o.priceCents),
      boughtBase: needBase,
      overbuyBase: 0,
      usedMultiBuy: false,
    };
  }
  const minQty = o.minQty ?? 1;
  const regular = o.regularPriceCents ?? o.priceCents;
  const needed = Math.max(1, Math.ceil(needBase / o.baseQuantity - EPS));
  const candidates: { packages: number; cost: number; multi: boolean }[] = [];
  if (needed >= minQty) {
    candidates.push({ packages: needed, cost: needed * o.priceCents, multi: minQty > 1 });
  } else {
    candidates.push({ packages: needed, cost: needed * regular, multi: false });
    candidates.push({ packages: minQty, cost: minQty * o.priceCents, multi: true });
  }
  candidates.sort((a, b) => a.cost - b.cost || a.packages - b.packages);
  const best = candidates[0];
  if (!best) throw new Error('unreachable');
  const bought = best.packages * o.baseQuantity;
  return {
    optionId: o.id,
    packages: best.packages,
    costCents: best.cost,
    boughtBase: bought,
    overbuyBase: Math.max(0, bought - needBase),
    usedMultiBuy: best.multi,
  };
}

function better(a: CoverResult, b: CoverResult): boolean {
  if (a.costCents !== b.costCents) return a.costCents < b.costCents;
  if (Math.abs(a.overbuyBase - b.overbuyBase) > EPS) return a.overbuyBase < b.overbuyBase;
  return a.optionId < b.optionId;
}

/**
 * Cheapest way to cover `needBase` (base units) with one of the given options at a single store.
 * Whole packages are bought (honest bulk math, SPEC §2.2). Ties: less overbuy, then option id.
 * Returns null when there are no options.
 */
export function coverCost(needBase: number, options: readonly CoverOption[]): CoverResult | null {
  if (!(needBase > 0)) throw new RangeError('needBase must be > 0');
  let best: CoverResult | null = null;
  for (const o of options) {
    const r = evaluate(needBase, o);
    if (best === null || better(r, best)) best = r;
  }
  return best;
}
