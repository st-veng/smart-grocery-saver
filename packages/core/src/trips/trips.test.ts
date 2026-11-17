import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, dayOfWeek, fromDayNumber, toDayNumber } from '../dates.js';
import { CIRCUITY_FACTOR, haversineMiles, type LatLng } from '../geo.js';
import { parseCsv } from '../lists/csv.js';
import type { CompareResult, LineAtStore, LineResult } from '../pricing/compare.js';
import {
  bucketStart,
  bucketsBetween,
  centsToDecimal,
  csvCell,
  formatDecimalCents,
  toCsv,
} from './ledger.js';
import { bestRoute, fuelCostCents, PlanError, planFromComparison } from './plan.js';

const at = (storeId: number, lineCents: number | null, extra: Partial<LineAtStore> = {}) =>
  ({
    storeId,
    status: lineCents === null ? 'missing' : 'ok',
    storeItemId: lineCents === null ? null : `si-${String(storeId)}`,
    title: lineCents === null ? null : `Item @${String(storeId)}`,
    brand: null,
    packages: lineCents === null ? null : 1,
    lineCents,
    unitPriceCents: lineCents,
    onSale: false,
    memberPrice: false,
    promoLabel: null,
    usedMultiBuy: false,
    approximate: false,
    overbuyBase: 0,
    ...extra,
  }) satisfies LineAtStore;

const line = (itemId: string, stores: LineAtStore[], unpriced = false): LineResult => ({
  itemId,
  unpriced,
  needBase: unpriced ? null : 1,
  needApproximate: false,
  stores,
  cheapestStoreIds: [],
});

function result(lines: LineResult[], baselineStoreId: number | null, storeIds = [1, 2, 3]) {
  return {
    lines,
    stores: storeIds.map((storeId) => ({
      storeId,
      totalCents: 0,
      pricedCount: 0,
      missingCount: 0,
      complete: true,
      savingsCents: null,
      savingsPct: null,
    })),
    excluded: [],
    cheapestStoreId: null,
    cheapestWithMissingStoreId: null,
    baseline: { storeId: baselineStoreId, source: 'user', totalCents: null },
    savingsPct: null,
    savingsCents: null,
    unpricedCount: 0,
  } satisfies CompareResult;
}

describe('planFromComparison', () => {
  const r = result(
    [
      line('milk', [at(1, 300), at(2, 250), at(3, 400)]),
      line('eggs', [at(1, 500), at(2, 500), at(3, 450, { overbuyBase: 6, packages: 2 })]),
      line('kale', [at(1, null), at(2, 199), at(3, 150)]),
      line('mystery', [], true),
      line('saffron', [at(1, 900), at(2, null), at(3, null)]),
    ],
    3,
  );

  it('single store: every item at that store, baseline lines from the baseline store', () => {
    const p = planFromComparison(r, [2]);
    expect(p.storeIds).toEqual([2]);
    expect(p.items.map((i) => [i.itemId, i.storeId, i.lineCents, i.baselineLineCents])).toEqual([
      ['milk', 2, 250, 400],
      ['eggs', 2, 500, 450],
      ['kale', 2, 199, 150],
    ]);
    expect(p.itemsCents).toBe(949);
    expect(p.baselineCents).toBe(1000);
    // Saffron isn't at the baseline store, so it is skipped on both sides (like-for-like).
    expect(p.skipped).toEqual([
      { itemId: 'mystery', reason: 'unpriced' },
      { itemId: 'saffron', reason: 'not_at_baseline' },
    ]);
  });

  it('multi store: cheapest line among the plan stores, ties go to the earlier store', () => {
    const p = planFromComparison(r, [1, 2]);
    expect(p.items.map((i) => [i.itemId, i.storeId])).toEqual([
      ['milk', 2],
      ['eggs', 1], // 500 at both → store 1 is listed first
      ['kale', 2],
    ]);
    expect(planFromComparison(r, [2, 1]).items[1]?.storeId).toBe(2);
  });

  it('records bought quantity including overbuy, and drops stores that got nothing', () => {
    const p = planFromComparison(r, [3]);
    const dear = result([line('a', [at(1, 500), at(2, null), at(3, 100)])], 3);
    expect(planFromComparison(dear, [3, 1]).storeIds).toEqual([3]);
    expect(p.items.find((i) => i.itemId === 'eggs')).toMatchObject({ boughtBase: 7, packages: 2 });
  });

  it('negative savings are kept honestly', () => {
    const p = planFromComparison(r, [1]);
    // Kale is missing at store 1 → not_in_plan_stores; milk + eggs cost more than at baseline.
    expect(p.skipped).toContainEqual({ itemId: 'kale', reason: 'not_in_plan_stores' });
    expect(p.baselineCents - p.itemsCents).toBe(850 - 800);
  });

  it('refuses without a baseline, an unknown store, or nothing to buy', () => {
    expect(() => planFromComparison(result(r.lines, null), [1])).toThrow(PlanError);
    expect(() => planFromComparison(r, [9])).toThrow(/not one of your stores/);
    const none = result([line('saffron', [at(1, null), at(2, 100), at(3, 100)])], 3);
    expect(() => planFromComparison(none, [1])).toThrow(
      expect.objectContaining({ code: 'NOTHING_TO_BUY' }),
    );
  });
});

describe('bestRoute / fuelCostCents', () => {
  const home: LatLng = { lat: 33.15, lng: -96.8065 };
  const p = (lat: number, lng: number) => ({ lat, lng });

  it('one stop is an out-and-back at road distance', () => {
    const s = p(33.2, -96.8);
    const r = bestRoute(home, [{ id: 7, at: s }]);
    expect(r.order).toEqual([7]);
    expect(r.miles).toBeCloseTo(2 * haversineMiles(home, s) * CIRCUITY_FACTOR, 2);
    expect(bestRoute(home, [])).toEqual({ order: [], miles: 0 });
  });

  it('matches brute force over all orders and never beats the straight-line bound', () => {
    const pt = fc.record({
      lat: fc.double({ min: 32.6, max: 33.4, noNaN: true }),
      lng: fc.double({ min: -97.3, max: -96.4, noNaN: true }),
    });
    fc.assert(
      fc.property(fc.array(pt, { minLength: 1, maxLength: 3 }), (pts) => {
        const stops = pts.map((at, i) => ({ id: i + 1, at }));
        const r = bestRoute(home, stops);
        const cost = (order: number[]) => {
          let m = 0;
          let cur = home;
          for (const id of order) {
            const nxt = stops[id - 1]?.at ?? home;
            m += haversineMiles(cur, nxt) * CIRCUITY_FACTOR;
            cur = nxt;
          }
          return m + haversineMiles(cur, home) * CIRCUITY_FACTOR;
        };
        expect(new Set(r.order)).toEqual(new Set(stops.map((s) => s.id)));
        expect(r.miles).toBeCloseTo(cost(r.order), 2);
        const orders =
          stops.length === 3
            ? [
                [1, 2, 3],
                [1, 3, 2],
                [2, 1, 3],
                [2, 3, 1],
                [3, 1, 2],
                [3, 2, 1],
              ]
            : stops.length === 2
              ? [
                  [1, 2],
                  [2, 1],
                ]
              : [[1]];
        for (const o of orders) expect(r.miles).toBeLessThanOrEqual(cost(o) + 0.006);
      }),
    );
  });

  it('fuel is miles / mpg × price, rounded half-even', () => {
    expect(fuelCostCents(10, 25, 279)).toBe(112); // 111.6
    expect(fuelCostCents(0, 25, 279)).toBe(0);
    expect(fuelCostCents(12.5, 25, 279)).toBe(140); // 139.5 → 140 (even)
    expect(fuelCostCents(2.5, 25, 285)).toBe(28); // 28.5 → 28 (even)
    expect(() => fuelCostCents(1, 0, 279)).toThrow(RangeError);
  });
});

describe('buckets', () => {
  it('weeks start Monday, months on the 1st', () => {
    expect(bucketStart('2026-11-01', 'week')).toBe('2026-10-26'); // Sunday → previous Monday
    expect(bucketStart('2026-11-02', 'week')).toBe('2026-11-02'); // Monday
    expect(bucketStart('2026-11-30', 'month')).toBe('2026-11-01');
    expect(bucketsBetween('2025-12-15', '2026-02-01', 'month')).toEqual([
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
    ]);
    expect(bucketsBetween('2026-02-01', '2026-01-01', 'month')).toEqual([]);
  });

  it('every date falls in exactly one bucket of the range (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 19000, max: 21000 }),
        fc.integer({ min: 0, max: 400 }),
        fc.constantFrom('week' as const, 'month' as const),
        (startDay, span, interval) => {
          const from = fromDayNumber(startDay);
          const to = addDays(from, span);
          const buckets = bucketsBetween(from, to, interval);
          expect([...buckets].sort()).toEqual(buckets);
          for (let d = 0; d <= span; d += 13) {
            const date = addDays(from, d);
            const b = bucketStart(date, interval);
            expect(buckets).toContain(b);
            expect(toDayNumber(b)).toBeLessThanOrEqual(toDayNumber(date));
            if (interval === 'week') expect(dayOfWeek(b)).toBe(1);
          }
        },
      ),
    );
  });
});

describe('CSV writer', () => {
  it('escapes formula-looking text but keeps numbers numeric', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    for (const c of ['+1', '-2', '@SUM(A1)', '\tx'])
      expect(csvCell(c).startsWith("'") || csvCell(c).startsWith(`"'`)).toBe(true);
    expect(csvCell(-1.5)).toBe('-1.5');
    expect(csvCell(centsToDecimal(-105))).toBe('-1.05');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
    expect(() => csvCell({ decimal: '=1' })).toThrow(RangeError);
  });

  it('formats cents exactly', () => {
    expect(formatDecimalCents(0)).toBe('0.00');
    expect(formatDecimalCents(5)).toBe('0.05');
    expect(formatDecimalCents(123456)).toBe('1234.56');
    expect(formatDecimalCents(-7)).toBe('-0.07');
  });

  it('round-trips through an RFC 4180 parser with CRLF records (property)', () => {
    const text = fc.string({ maxLength: 20 }).filter((s) => !/^[=+\-@\t\r]/.test(s));
    const row = fc.array(text, { minLength: 3, maxLength: 3 });
    fc.assert(
      fc.property(fc.array(row, { minLength: 1, maxLength: 5 }), (rows) => {
        const out = toCsv(rows);
        expect(out.endsWith('\r\n')).toBe(true);
        expect(parseCsv(out).map((r) => r.cells)).toEqual(rows);
      }),
      { numRuns: 300 },
    );
  });
});
