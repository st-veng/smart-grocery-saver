import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toBase } from '../units/convert.js';
import { coverCost, type CoverOption } from './cover-cost.js';
import { unitPriceCents } from './unit-price.js';

const GAL = toBase(1, 'gal');
const LB = toBase(1, 'lb');

describe('unitPriceCents', () => {
  it('computes per display unit for each dimension', () => {
    expect(unitPriceCents(389, GAL, 'gal')).toBeCloseTo(389, 9);
    expect(unitPriceCents(389, GAL, 'fl_oz')).toBeCloseTo(389 / 128, 9);
    expect(unitPriceCents(499, toBase(16, 'oz'), 'lb')).toBeCloseTo(499, 9);
    expect(unitPriceCents(299, 12, 'ea')).toBeCloseTo(299 / 12, 9);
    expect(unitPriceCents(299, 12, 'dozen')).toBeCloseTo(299, 9);
  });
  it('rejects zero base quantity', () => {
    expect(() => unitPriceCents(100, 0, 'g')).toThrow(RangeError);
  });
});

describe('coverCost', () => {
  const krogerGallon: CoverOption = {
    id: 'kroger-1gal',
    basis: 'per_package',
    baseQuantity: GAL,
    priceCents: 389,
  };
  const costcoTwoPack: CoverOption = {
    id: 'costco-2x1gal',
    basis: 'per_package',
    baseQuantity: 2 * GAL,
    priceCents: 649,
  };

  it('buys whole packages and reports overbuy', () => {
    const r = coverCost(1.5 * GAL, [krogerGallon]);
    expect(r).toMatchObject({ packages: 2, costCents: 778 });
    expect(r?.overbuyBase).toBeCloseTo(0.5 * GAL, 6);
  });

  it('a bulk pack with the better unit price can still cost more for a small need', () => {
    expect(unitPriceCents(649, 2 * GAL, 'gal')).toBeLessThan(389);
    const r = coverCost(GAL, [krogerGallon, costcoTwoPack]);
    expect(r?.optionId).toBe('kroger-1gal');
    expect(r?.costCents).toBe(389);
  });

  it('prefers the bulk pack when the need is large enough', () => {
    expect(coverCost(2 * GAL, [krogerGallon, costcoTwoPack])?.optionId).toBe('costco-2x1gal');
  });

  it('does not round up an exact multiple because of float noise', () => {
    const r = coverCost(toBase(128, 'fl_oz'), [krogerGallon]);
    expect(r?.packages).toBe(1);
  });

  describe('multi-buy (min_qty)', () => {
    const twoFor5: CoverOption = {
      id: 'cereal',
      basis: 'per_package',
      baseQuantity: 500,
      priceCents: 250,
      regularPriceCents: 399,
      minQty: 2,
    };
    it('pays regular price below the minimum when that is cheaper', () => {
      const r = coverCost(500, [{ ...twoFor5, priceCents: 350 }]);
      expect(r).toMatchObject({ packages: 1, costCents: 399, usedMultiBuy: false });
    });
    it('buys up to the minimum when the deal makes that cheaper', () => {
      const r = coverCost(500, [{ ...twoFor5, priceCents: 150 }]);
      expect(r).toMatchObject({ packages: 2, costCents: 300, usedMultiBuy: true });
    });
    it('applies the deal when the need already meets the minimum', () => {
      expect(coverCost(1000, [twoFor5])).toMatchObject({
        packages: 2,
        costCents: 500,
        usedMultiBuy: true,
      });
    });
  });

  it('prices per-weight items by exact weight with half-even rounding', () => {
    const beef: CoverOption = {
      id: 'beef',
      basis: 'per_weight',
      baseQuantity: LB,
      priceCents: 499,
    };
    expect(coverCost(1.5 * LB, [beef])).toMatchObject({
      packages: null,
      costCents: 748,
      overbuyBase: 0,
    });
    // 0.5 lb × 499 = 249.5 → 250 (even)
    expect(coverCost(0.5 * LB, [beef])?.costCents).toBe(250);
    // 0.5 lb × 497 = 248.5 → 248 (even)
    expect(coverCost(0.5 * LB, [{ ...beef, priceCents: 497 }])?.costCents).toBe(248);
  });

  it('breaks cost ties by less overbuy, then by id', () => {
    const a: CoverOption = { id: 'b', basis: 'per_package', baseQuantity: 2, priceCents: 200 };
    const b: CoverOption = { id: 'a', basis: 'per_package', baseQuantity: 4, priceCents: 200 };
    expect(coverCost(2, [b, a])?.optionId).toBe('b');
    const c: CoverOption = { ...a, id: 'a' };
    expect(coverCost(2, [a, c])?.optionId).toBe('a');
  });

  it('returns null with no options and rejects non-positive need', () => {
    expect(coverCost(1, [])).toBeNull();
    expect(() => coverCost(0, [krogerGallon])).toThrow(RangeError);
  });

  it('property: cost is monotonic in need and never below the exact pro-rated cost', () => {
    const option = fc.record({
      id: fc.string({ minLength: 1, maxLength: 3 }),
      basis: fc.constant('per_package' as const),
      baseQuantity: fc.integer({ min: 1, max: 5000 }),
      priceCents: fc.integer({ min: 1, max: 5000 }),
    });
    fc.assert(
      fc.property(
        fc.array(option, { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 1, max: 20000 }),
        (opts, need) => {
          const once = coverCost(need, opts);
          const twice = coverCost(need * 2, opts);
          if (!once || !twice) return false;
          const cheapestUnit = Math.min(...opts.map((o) => o.priceCents / o.baseQuantity));
          return (
            twice.costCents >= once.costCents && once.costCents >= Math.floor(cheapestUnit * need)
          );
        },
      ),
    );
  });
});
