import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, diffDays } from '../dates.js';
import { toBase } from '../units/convert.js';
import type { Offer } from './compare.js';
import {
  lowestIn,
  lowestOn,
  offerUnitPrice,
  shouldTrigger,
  stepSeries,
  yearBefore,
  yearEndingOn,
  type UnitPricePeriod,
} from './history.js';

let id = 0;
const P = (from: string, to: string | null, unitPriceCents: number): UnitPricePeriod => ({
  from,
  to,
  unitPriceCents,
  pricePointId: ++id,
});

describe('stepSeries', () => {
  // Two items at one store: a regular item and a cheaper one that goes on sale for a week.
  const periods = [
    P('2026-01-01', '2026-02-01', 300),
    P('2026-02-01', null, 320),
    P('2026-01-01', '2026-01-10', 310),
    P('2026-01-10', '2026-01-17', 250),
    P('2026-01-17', null, 310),
  ];

  it('tracks the daily lowest price across items, with points only where it changes', () => {
    expect(stepSeries(periods, { from: '2026-01-01', to: '2026-03-01' })).toEqual([
      { date: '2026-01-01', unitPriceCents: 300 },
      { date: '2026-01-10', unitPriceCents: 250 },
      { date: '2026-01-17', unitPriceCents: 300 },
      { date: '2026-02-01', unitPriceCents: 310 },
    ]);
  });

  it('clips to the range: starts at range.from, ignores changes after range.to', () => {
    expect(stepSeries(periods, { from: '2026-01-12', to: '2026-01-20' })).toEqual([
      { date: '2026-01-12', unitPriceCents: 250 },
      { date: '2026-01-17', unitPriceCents: 300 },
    ]);
    expect(stepSeries(periods, { from: '2026-01-02', to: '2026-01-05' })).toEqual([
      { date: '2026-01-02', unitPriceCents: 300 },
    ]);
  });

  it('reports gaps (nothing carried) as null and before-history as a single null point', () => {
    const gappy = [P('2026-01-01', '2026-01-05', 100), P('2026-01-08', null, 120)];
    expect(stepSeries(gappy, { from: '2026-01-01', to: '2026-01-10' })).toEqual([
      { date: '2026-01-01', unitPriceCents: 100 },
      { date: '2026-01-05', unitPriceCents: null },
      { date: '2026-01-08', unitPriceCents: 120 },
    ]);
    expect(stepSeries(gappy, { from: '2025-01-01', to: '2025-01-10' })).toEqual([
      { date: '2025-01-01', unitPriceCents: null },
    ]);
  });

  it('property: every day in range equals the brute-force daily lowest', () => {
    const periodArb = fc
      .array(
        fc.record({
          start: fc.integer({ min: 0, max: 60 }),
          len: fc.option(fc.integer({ min: 1, max: 30 }), { nil: null }),
          price: fc.integer({ min: 1, max: 500 }),
        }),
        { minLength: 1, maxLength: 8 },
      )
      .map((xs) =>
        xs.map((x) =>
          P(
            addDays('2026-01-01', x.start),
            x.len === null ? null : addDays('2026-01-01', x.start + x.len),
            x.price,
          ),
        ),
      );
    fc.assert(
      fc.property(
        periodArb,
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 40 }),
        (ps, a, len) => {
          const range = { from: addDays('2026-01-01', a), to: addDays('2026-01-01', a + len) };
          const series = stepSeries(ps, range);
          for (let d = 0; d <= len; d++) {
            const day = addDays(range.from, d);
            const point = [...series].reverse().find((p) => diffDays(day, p.date) >= 0);
            expect(point?.unitPriceCents ?? null).toBe(lowestOn(ps, day));
          }
        },
      ),
    );
  });
});

describe('lowestIn / windows', () => {
  it('finds the lowest price in the window and the first day it applied', () => {
    const ps = [
      P('2025-06-01', '2025-07-01', 200),
      P('2025-07-01', '2025-12-01', 180),
      P('2025-12-01', null, 190),
    ];
    expect(lowestIn(ps, yearEndingOn('2026-01-15'))).toMatchObject({
      unitPriceCents: 180,
      date: '2025-07-01',
    });
    // A period that started before the window counts from the window start.
    expect(lowestIn(ps, { from: '2025-08-01', to: '2025-09-01' })).toMatchObject({
      unitPriceCents: 180,
      date: '2025-08-01',
    });
    expect(lowestIn(ps, { from: '2020-01-01', to: '2020-02-01' })).toBeNull();
  });

  it('windows: 365 days ending on asOf, and the 365 days before it', () => {
    expect(yearEndingOn('2026-11-01')).toEqual({ from: '2025-11-02', to: '2026-11-01' });
    expect(yearBefore('2026-11-02')).toEqual({ from: '2025-11-02', to: '2026-11-01' });
  });
});

describe('shouldTrigger (Q-7)', () => {
  it('historic low must be strictly lower than the prior low — a tie does not fire', () => {
    expect(shouldTrigger('historic_low', 99, 100, null)).toBe(true);
    expect(shouldTrigger('historic_low', 100, 100, null)).toBe(false);
    expect(shouldTrigger('historic_low', 101, 100, null)).toBe(false);
    expect(shouldTrigger('historic_low', 50, null, null)).toBe(false); // no history to beat
    expect(shouldTrigger('historic_low', null, 100, null)).toBe(false);
  });

  it('target price fires at or below the target', () => {
    expect(shouldTrigger('target_price', 150, null, 150)).toBe(true);
    expect(shouldTrigger('target_price', 149.9, null, 150)).toBe(true);
    expect(shouldTrigger('target_price', 150.1, null, 150)).toBe(false);
    expect(shouldTrigger('target_price', 100, null, null)).toBe(false);
  });
});

describe('offerUnitPrice', () => {
  const store = {
    id: 5,
    slug: 'kroger',
    name: 'Kroger',
    sortOrder: 5,
    requiresMembership: false,
    loyaltyProgram: 'Kroger Plus Card',
  };
  const milk = { dimension: 'volume' as const, displayUnit: 'fl_oz' as const, avgEachGrams: null };
  const base: Offer = {
    storeItemId: 'x',
    storeId: 5,
    productId: 'milk',
    title: 'Milk',
    brand: null,
    isStoreBrand: true,
    basis: 'per_package',
    baseQuantity: toBase(1, 'gal'),
    unit: 'gal',
    regularPriceCents: 384,
    salePriceCents: 256,
    promoLabel: 'Card price',
    minQty: 1,
    memberOnly: true,
  };
  it('uses the member price only with the card', () => {
    expect(
      offerUnitPrice(base, milk, store, { enabled: true, hasMembership: false, hasLoyalty: true })
        ?.unitPriceCents,
    ).toBeCloseTo(2, 9);
    expect(
      offerUnitPrice(base, milk, store, { enabled: true, hasMembership: false, hasLoyalty: false })
        ?.unitPriceCents,
    ).toBeCloseTo(3, 9);
  });
  it('values a single package of a multi-buy at its regular price', () => {
    const multi = { ...base, memberOnly: false, minQty: 2 };
    expect(
      offerUnitPrice(multi, milk, store, { enabled: true, hasMembership: false, hasLoyalty: true }),
    ).toMatchObject({ priceCents: 384, onSale: false });
  });
  it('returns null across incompatible dimensions', () => {
    expect(
      offerUnitPrice({ ...base, unit: 'lb', baseQuantity: toBase(1, 'lb') }, milk, store, {
        enabled: true,
        hasMembership: false,
        hasLoyalty: true,
      }),
    ).toBeNull();
  });
});
