import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toBase } from '../units/convert.js';
import type { UnitCode } from '../units/table.js';
import {
  compareList,
  effectivePrice,
  type CompareInput,
  type CompareLine,
  type CompareProduct,
  type CompareStore,
  type Offer,
  type StoreSettings,
} from './compare.js';

const store = (id: number, slug: string, extra: Partial<CompareStore> = {}): CompareStore => ({
  id,
  slug,
  name: slug,
  sortOrder: id,
  requiresMembership: false,
  loyaltyProgram: null,
  ...extra,
});
const WALMART = store(1, 'walmart');
const COSTCO = store(2, 'costco', { requiresMembership: true });
const KROGER = store(5, 'kroger', { loyaltyProgram: 'Kroger Plus Card' });
const TOMTHUMB = store(8, 'tomthumb', { loyaltyProgram: 'Tom Thumb for U' });
const ALL = [WALMART, COSTCO, KROGER, TOMTHUMB];

const on = (extra: Partial<StoreSettings> = {}): StoreSettings => ({
  enabled: true,
  hasMembership: false,
  hasLoyalty: true,
  ...extra,
});
const settings = (over: Record<number, Partial<StoreSettings>> = {}) =>
  new Map(ALL.map((s) => [s.id, on({ hasMembership: s.requiresMembership, ...over[s.id] })]));

const MILK: CompareProduct = {
  id: 'milk',
  name: 'Whole Milk',
  dimension: 'volume',
  displayUnit: 'fl_oz',
  defaultQuantity: 1,
  defaultUnit: 'gal',
  avgEachGrams: null,
};
const BEEF: CompareProduct = {
  id: 'beef',
  name: 'Ground Beef',
  dimension: 'mass',
  displayUnit: 'lb',
  defaultQuantity: 1,
  defaultUnit: 'lb',
  avgEachGrams: null,
};
const EGGS: CompareProduct = {
  id: 'eggs',
  name: 'Eggs',
  dimension: 'count',
  displayUnit: 'ea',
  defaultQuantity: 12,
  defaultUnit: 'ea',
  avgEachGrams: null,
};
const LEMONS: CompareProduct = {
  id: 'lemons',
  name: 'Lemons',
  dimension: 'count',
  displayUnit: 'ea',
  defaultQuantity: 1,
  defaultUnit: 'ea',
  avgEachGrams: 100,
};

let seq = 0;
const offer = (
  storeId: number,
  p: CompareProduct,
  size: [number, UnitCode],
  price: number,
  extra: Partial<Offer> = {},
): Offer => ({
  storeItemId: `si-${String(++seq)}`,
  storeId,
  productId: p.id,
  title: `${p.name} ${String(size[0])} ${size[1]}`,
  brand: null,
  isStoreBrand: true,
  basis: 'per_package',
  baseQuantity: toBase(size[0], size[1]),
  unit: size[1],
  regularPriceCents: price,
  salePriceCents: null,
  promoLabel: null,
  minQty: 1,
  memberOnly: false,
  ...extra,
});
const line = (
  p: CompareProduct | null,
  quantity = 1,
  unit: UnitCode | null = null,
  extra: Partial<CompareLine> = {},
): CompareLine => ({
  itemId: `line-${String(++seq)}`,
  product: p,
  quantity,
  unit,
  matchMode: 'any',
  brand: null,
  storeItemId: null,
  ...extra,
});
const run = (lines: CompareLine[], offers: Offer[], extra: Partial<CompareInput> = {}) =>
  compareList({
    lines,
    offers,
    stores: ALL,
    settings: settings(),
    baselineStoreId: KROGER.id,
    ...extra,
  });
const at = (r: ReturnType<typeof run>, lineIdx: number, storeId: number) =>
  r.lines[lineIdx]?.stores.find((s) => s.storeId === storeId);

describe('compareList — unit prices and package math', () => {
  it('reports unit price per display unit for all three dimensions', () => {
    const r = run(
      [line(MILK), line(BEEF), line(EGGS)],
      [
        offer(1, MILK, [1, 'gal'], 384),
        offer(1, BEEF, [1, 'lb'], 499, { basis: 'per_weight' }),
        offer(1, EGGS, [12, 'ea'], 300),
      ],
    );
    expect(at(r, 0, 1)?.unitPriceCents).toBeCloseTo(3, 9); // 384¢ / 128 fl oz
    expect(at(r, 1, 1)?.unitPriceCents).toBeCloseTo(499, 9); // per lb
    expect(at(r, 2, 1)?.unitPriceCents).toBeCloseTo(25, 9); // per egg
  });

  it('a bulk pack with the better unit price costs more for a small need — line cost decides', () => {
    const r = run(
      [line(MILK, 1, 'gal')],
      [offer(1, MILK, [1, 'gal'], 389), offer(2, MILK, [2, 'gal'], 649)],
    );
    expect(at(r, 0, 2)).toMatchObject({ lineCents: 649, packages: 1 });
    expect(at(r, 0, 2)?.unitPriceCents).toBeLessThan(at(r, 0, 1)?.unitPriceCents ?? 0);
    expect(at(r, 0, 2)?.overbuyBase).toBeCloseTo(toBase(1, 'gal'), 6);
    expect(r.lines[0]?.cheapestStoreIds).toEqual([1]);
  });

  it('honours multi-buy minimums (2 for $5)', () => {
    const deal = { salePriceCents: 250, promoLabel: '2 for $5.00', minQty: 2 };
    const one = run([line(BEEF, 1, null)], [offer(1, BEEF, [1, 'lb'], 400, deal)]);
    expect(at(one, 0, 1)).toMatchObject({ lineCents: 400, onSale: false, usedMultiBuy: false }); // buying 1 → regular
    const cheap = run([line(BEEF, 1, null)], [offer(1, BEEF, [1, 'lb'], 600, deal)]);
    expect(at(cheap, 0, 1)).toMatchObject({
      lineCents: 500,
      packages: 2,
      onSale: true,
      usedMultiBuy: true,
    }); // 2 for $5 beats 1 × $6
  });

  it('prices per-weight items by exact weight with half-even rounding', () => {
    const r = run(
      [line(BEEF, 0.5, 'lb')],
      [offer(1, BEEF, [1, 'lb'], 499, { basis: 'per_weight' })],
    );
    expect(at(r, 0, 1)).toMatchObject({ lineCents: 250, packages: null }); // 249.5 → 250 (even)
    const r2 = run(
      [line(BEEF, 0.5, 'lb')],
      [offer(1, BEEF, [1, 'lb'], 497, { basis: 'per_weight' })],
    );
    expect(at(r2, 0, 1)?.lineCents).toBe(248); // 248.5 → 248 (even)
  });

  it('bridges count ↔ weight with the average weight and flags it approximate', () => {
    const r = run(
      [line(LEMONS, 10, 'ea')],
      [offer(1, LEMONS, [1, 'ea'], 69), offer(2, LEMONS, [2, 'lb'], 399)],
    );
    expect(at(r, 0, 1)).toMatchObject({ lineCents: 690, approximate: false });
    // 2 lb bag ≈ 907 g ≈ 9.07 lemons → 2 bags to cover 10
    expect(at(r, 0, 2)).toMatchObject({ packages: 2, lineCents: 798, approximate: true });
    // Without an average weight the bag cannot be compared at all.
    const noAvg = run(
      [line({ ...LEMONS, avgEachGrams: null }, 10, 'ea')],
      [offer(2, LEMONS, [2, 'lb'], 399)],
    );
    expect(at(noAvg, 0, 2)?.status).toBe('missing');
  });

  it('a list item with no unit means N × the product default package', () => {
    const r = run(
      [line(EGGS, 2)],
      [offer(1, EGGS, [18, 'ea'], 400), offer(1, EGGS, [12, 'ea'], 300)],
    );
    expect(r.lines[0]?.needBase).toBe(24);
    expect(at(r, 0, 1)).toMatchObject({ lineCents: 600, packages: 2 }); // 2 × 12 beats 2 × 18 (= $8)
  });
});

describe('compareList — eligibility, brand and loyalty rules', () => {
  it('brand mode only considers that brand; exact-item mode only that store item', () => {
    const sb = offer(1, MILK, [1, 'gal'], 300, { brand: 'Great Value' });
    const nb = offer(1, MILK, [1, 'gal'], 450, { brand: 'Borden', isStoreBrand: false });
    const k = offer(5, MILK, [1, 'gal'], 420, { brand: 'Borden', isStoreBrand: false });
    const brand = run([line(MILK, 1, null, { matchMode: 'brand', brand: 'borden' })], [sb, nb, k]);
    expect(at(brand, 0, 1)).toMatchObject({ lineCents: 450, brand: 'Borden' });
    expect(brand.lines[0]?.cheapestStoreIds).toEqual([5]);
    const exact = run(
      [line(MILK, 1, null, { matchMode: 'exact_item', storeItemId: nb.storeItemId })],
      [sb, nb, k],
    );
    expect(at(exact, 0, 1)?.storeItemId).toBe(nb.storeItemId);
    expect(at(exact, 0, 5)?.status).toBe('missing');
  });

  it('omits warehouse clubs without a membership and disabled stores (never greyed out)', () => {
    const offers = [
      offer(1, MILK, [1, 'gal'], 389),
      offer(2, MILK, [1, 'gal'], 300),
      offer(5, MILK, [1, 'gal'], 399),
    ];
    const r = run([line(MILK)], offers, {
      settings: settings({ 2: { hasMembership: false }, 8: { enabled: false } }),
    });
    expect(r.stores.map((s) => s.storeId)).toEqual([1, 5]);
    expect(r.excluded).toEqual([
      { storeId: 2, reason: 'no_membership' },
      { storeId: 8, reason: 'disabled' },
    ]);
    const member = run([line(MILK)], offers);
    expect(member.cheapestStoreId).toBe(2);
  });

  it('loyalty prices (Kroger, Tom Thumb) apply only with the card on; non-members pay regular', () => {
    const card = { salePriceCents: 249, promoLabel: 'Card price', memberOnly: true };
    const offers = [
      offer(5, MILK, [1, 'gal'], 399, card),
      offer(8, MILK, [1, 'gal'], 429, { ...card, salePriceCents: 279, promoLabel: 'for U price' }),
      offer(1, MILK, [1, 'gal'], 289),
    ];
    const withCards = run([line(MILK)], offers);
    expect(at(withCards, 0, 5)).toMatchObject({
      lineCents: 249,
      onSale: true,
      memberPrice: true,
      promoLabel: 'Card price',
    });
    expect(withCards.cheapestStoreId).toBe(5);
    const noCards = run([line(MILK)], offers, {
      settings: settings({ 5: { hasLoyalty: false }, 8: { hasLoyalty: false } }),
    });
    expect(at(noCards, 0, 5)).toMatchObject({ lineCents: 399, onSale: false, memberPrice: false });
    expect(at(noCards, 0, 8)?.lineCents).toBe(429);
    expect(noCards.cheapestStoreId).toBe(1);
    // A plain (non-member) sale applies to everyone.
    expect(
      effectivePrice(offer(1, MILK, [1, 'gal'], 300, { salePriceCents: 250 }), WALMART, on())
        .priceCents,
    ).toBe(250);
  });

  it('a store missing an item is incomplete and never the cheapest for the whole list', () => {
    const r = run(
      [line(MILK), line(EGGS)],
      [
        offer(1, MILK, [1, 'gal'], 389),
        offer(1, EGGS, [12, 'ea'], 299),
        offer(2, MILK, [1, 'gal'], 100),
      ],
    );
    expect(r.stores.find((s) => s.storeId === 2)).toMatchObject({
      complete: false,
      missingCount: 1,
      totalCents: 100,
      savingsPct: null,
    });
    expect(r.cheapestStoreId).toBe(1);
    expect(r.cheapestWithMissingStoreId).toBe(1);
  });

  it('unmatched lines are unpriced and do not make stores incomplete', () => {
    const r = run([line(null), line(MILK)], [offer(1, MILK, [1, 'gal'], 389)], {
      onlyStoreIds: [1],
    });
    expect(r.unpricedCount).toBe(1);
    expect(r.stores).toEqual([
      expect.objectContaining({ storeId: 1, complete: true, totalCents: 389 }),
    ]);
  });

  it('ties go to every tied store per line, and to display order for the whole list', () => {
    const r = run([line(MILK)], [offer(5, MILK, [1, 'gal'], 300), offer(1, MILK, [1, 'gal'], 300)]);
    expect(r.lines[0]?.cheapestStoreIds).toEqual([1, 5]);
    expect(r.cheapestStoreId).toBe(1);
  });

  it('within a store, an exact cost tie picks the same item regardless of ids or input order', () => {
    const a = offer(1, MILK, [1, 'gal'], 300, { title: 'Brand A Milk', storeItemId: 'zzz' });
    const b = offer(1, MILK, [1, 'gal'], 300, { title: 'Brand B Milk', storeItemId: 'aaa' });
    for (const offers of [
      [a, b],
      [b, a],
    ]) {
      expect(at(run([line(MILK)], offers), 0, 1)?.title).toBe('Brand A Milk');
    }
  });
});

describe('compareList — savings vs the baseline (Q-2)', () => {
  it('uses the usual store; falls back to the median complete store', () => {
    const offers = [
      offer(1, MILK, [1, 'gal'], 300),
      offer(2, MILK, [1, 'gal'], 330),
      offer(5, MILK, [1, 'gal'], 400),
      offer(8, MILK, [1, 'gal'], 450),
    ];
    const r = run([line(MILK)], offers);
    expect(r.baseline).toEqual({ storeId: 5, source: 'user', totalCents: 400 });
    expect(r).toMatchObject({ cheapestStoreId: 1, savingsCents: 100, savingsPct: 25 });
    expect(r.stores.find((s) => s.storeId === 8)).toMatchObject({
      savingsCents: -50,
      savingsPct: -12.5,
    });
    const median = run([line(MILK)], offers, { baselineStoreId: null });
    expect(median.baseline).toEqual({ storeId: 2, source: 'median', totalCents: 330 });
  });
});

describe('compareList — properties', () => {
  const storesArb = fc.uniqueArray(fc.constantFrom(1, 2, 5, 8), { minLength: 1, maxLength: 4 });
  const offersArb = fc.array(
    fc.record({
      storeId: fc.constantFrom(1, 2, 5, 8),
      product: fc.constantFrom(MILK, BEEF, EGGS),
      size: fc.integer({ min: 1, max: 4 }),
      price: fc.integer({ min: 50, max: 2000 }),
      sale: fc.option(fc.integer({ min: 1, max: 49 }), { nil: null }),
    }),
    { minLength: 1, maxLength: 20 },
  );
  const linesArb = fc.array(
    fc.record({ product: fc.constantFrom(MILK, BEEF, EGGS), qty: fc.integer({ min: 1, max: 6 }) }),
    { minLength: 1, maxLength: 6 },
  );
  const build = (
    os: {
      storeId: number;
      product: CompareProduct;
      size: number;
      price: number;
      sale: number | null;
    }[],
  ) =>
    os.map((o) =>
      offer(
        o.storeId,
        o.product,
        [o.size * o.product.defaultQuantity, o.product.defaultUnit],
        o.price,
        o.sale === null ? {} : { salePriceCents: o.price - o.sale },
      ),
    );

  it('the cheapest store total ≤ every complete store total; savings % < 100', () => {
    fc.assert(
      fc.property(linesArb, offersArb, storesArb, (ls, os, only) => {
        const r = run(
          ls.map((l) => line(l.product, l.qty)),
          build(os),
          { onlyStoreIds: only },
        );
        const cheapest = r.stores.find((s) => s.storeId === r.cheapestStoreId);
        for (const s of r.stores)
          if (s.complete && cheapest) expect(cheapest.totalCents).toBeLessThanOrEqual(s.totalCents);
        if (r.cheapestStoreId === null) expect(r.stores.every((s) => !s.complete)).toBe(true);
        for (const s of r.stores) if (s.savingsPct !== null) expect(s.savingsPct).toBeLessThan(100);
      }),
    );
  });

  it('doubling every quantity never lowers any line cost', () => {
    fc.assert(
      fc.property(linesArb, offersArb, (ls, os) => {
        const offers = build(os);
        const once = run(
          ls.map((l) => line(l.product, l.qty)),
          offers,
        );
        const twice = run(
          ls.map((l) => line(l.product, l.qty * 2)),
          offers,
        );
        once.lines.forEach((l, i) => {
          l.stores.forEach((s, j) => {
            const t = twice.lines[i]?.stores[j];
            if (s.lineCents !== null && t?.lineCents != null)
              expect(t.lineCents).toBeGreaterThanOrEqual(s.lineCents);
          });
        });
      }),
    );
  });
});
