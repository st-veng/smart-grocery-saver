import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LatLng } from '../geo.js';
import { roundHalfEven } from '../money.js';
import type { CompareResult, LineAtStore, LineResult } from '../pricing/compare.js';
import { bestRoute, fuelCostCents } from '../trips/plan.js';
import {
  DRIVING_MPH,
  multiThresholdCents,
  optimize,
  recommend,
  type OptimizedPlan,
  type OptimizeOptions,
} from './optimize.js';

const HOME: LatLng = { lat: 33.15, lng: -96.8065 };

/** A tiny CompareResult: prices[item][store] = line cents, or null when the store lacks it. */
function result(
  prices: readonly (readonly (number | null)[])[],
  storeIds: readonly number[],
  baselineStoreId: number | null = null,
): CompareResult {
  const lines: LineResult[] = prices.map((row, i) => ({
    itemId: `i${String(i)}`,
    unpriced: false,
    needBase: 1,
    needApproximate: false,
    cheapestStoreIds: [],
    stores: storeIds.map((storeId, k): LineAtStore => ({
      storeId,
      status: row[k] === null || row[k] === undefined ? 'missing' : 'ok',
      storeItemId: row[k] == null ? null : `s${String(storeId)}-${String(i)}`,
      title: row[k] == null ? null : 'x',
      brand: null,
      packages: 1,
      lineCents: row[k] ?? null,
      unitPriceCents: row[k] ?? null,
      onSale: false,
      memberPrice: false,
      promoLabel: null,
      usedMultiBuy: false,
      approximate: false,
      overbuyBase: 0,
    })),
  }));
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
  };
}

const at = (dLat: number, dLng: number): LatLng => ({ lat: HOME.lat + dLat, lng: HOME.lng + dLng });

const opts = (
  locations: Map<number, LatLng>,
  over: Partial<OptimizeOptions> = {},
): OptimizeOptions => ({
  maxStores: 3,
  home: HOME,
  locations,
  mpg: 25,
  fuelCentsPerGal: 279,
  timeValueCentsPerHour: 0,
  minutesPerStop: 10,
  ...over,
});

const best = (r: ReturnType<typeof optimize>): OptimizedPlan =>
  [r.single, ...r.multi].sort(
    (a, b) => a.missing.length - b.missing.length || a.totalCents - b.totalCents,
  )[0] ?? r.single;

describe('optimize', () => {
  const locs = new Map([
    [1, at(0.02, 0)],
    [2, at(-0.03, 0.01)],
    [3, at(0, 0.04)],
  ]);

  it('assigns each item to its cheapest store in the plan and costs the route', () => {
    const r = optimize(
      result(
        [
          [500, 300, 450],
          [200, 260, null],
          [999, 999, 100],
        ],
        [1, 2, 3],
        1,
      ),
      opts(locs, { maxStores: 3 }),
    );
    const all = [r.single, ...r.multi].find((p) => p.storeIds.join() === '1,2,3');
    expect(all?.assignments.map((a) => [a.itemId, a.storeId, a.lineCents])).toEqual([
      ['i0', 2, 300],
      ['i1', 1, 200],
      ['i2', 3, 100],
    ]);
    const route = bestRoute(
      HOME,
      [1, 2, 3].map((id) => ({ id, at: locs.get(id) ?? HOME })),
    );
    expect(all?.distanceMiles).toBe(route.miles);
    expect(all?.fuelCents).toBe(fuelCostCents(route.miles, 25, 279));
    expect(all?.baselineCents).toBe(500 + 200 + 999);
    expect(all?.savingsVsBaselineCents).toBe(1699 - 600 - (all?.fuelCents ?? 0));
  });

  it('zero items: a $0 plan that goes nowhere', () => {
    const r = optimize(result([], [1, 2, 3]), opts(locs));
    expect(r.single).toMatchObject({
      storeIds: [],
      route: [],
      itemsCents: 0,
      distanceMiles: 0,
      fuelCents: 0,
      timeCents: 0,
      totalCents: 0,
      complete: true,
    });
    expect(r.multi).toEqual([]);
    expect(r.recommendation.kind).toBe('single');
  });

  it('plans missing items rank below complete ones, however cheap', () => {
    // Store 1 is cheap but lacks item 1; store 2 has everything.
    const r = optimize(
      result(
        [
          [100, 900],
          [null, 900],
        ],
        [1, 2],
      ),
      opts(locs, { maxStores: 1 }),
    );
    expect(r.single.storeIds).toEqual([2]);
    expect(r.single.complete).toBe(true);
  });

  it('maxStores = 1 is the cheapest store plus its fuel', () => {
    const prices = [
      [500, 450, 470],
      [300, 330, 310],
    ];
    const r = optimize(result(prices, [1, 2, 3]), opts(locs, { maxStores: 1, fuelCentsPerGal: 0 }));
    expect(r.single.storeIds).toEqual([2]); // 780 vs 800 / 780 → tie broken by fewer/lower id
    expect(r.multi).toEqual([]);
    const withFuel = optimize(result(prices, [1, 2, 3]), opts(locs, { maxStores: 1 }));
    expect(withFuel.single.totalCents).toBe(withFuel.single.itemsCents + withFuel.single.fuelCents);
  });

  it('time cost: stops × minutes plus driving at 30 mph, only when a value is set', () => {
    const r = optimize(
      result([[100, 100]], [1, 2]),
      opts(locs, { maxStores: 1, timeValueCentsPerHour: 1800, minutesPerStop: 10 }),
    );
    const hours = 10 / 60 + r.single.distanceMiles / DRIVING_MPH;
    expect(r.single.timeCents).toBe(roundHalfEven(1800 * hours));
    expect(r.single.totalCents).toBe(r.single.itemsCents + r.single.fuelCents + r.single.timeCents);
    // Time is a ranking cost; savings match what a committed trip records (items + fuel only).
    expect(
      optimize(
        result([[100, 100]], [1, 2], 1),
        opts(locs, { maxStores: 1, timeValueCentsPerHour: 1800 }),
      ).single.savingsVsBaselineCents,
    ).toBe(-r.single.fuelCents);
  });

  it('skips stores without a location and refuses a bad maxStores', () => {
    const r = optimize(result([[100, 50]], [1, 9]), opts(locs, { maxStores: 2 }));
    expect(r.single.storeIds).toEqual([1]);
    expect(() => optimize(result([], [1]), opts(locs, { maxStores: 0 }))).toThrow(RangeError);
  });

  it('equals a brute-force oracle over every assignment on 200 random small instances', () => {
    const store = fc.record({
      dLat: fc.double({ min: -0.15, max: 0.15, noNaN: true }),
      dLng: fc.double({ min: -0.15, max: 0.15, noNaN: true }),
    });
    const instance = fc
      .record({
        stores: fc.array(store, { minLength: 1, maxLength: 5 }),
        items: fc.integer({ min: 0, max: 5 }),
        maxStores: fc.integer({ min: 1, max: 3 }),
        fuel: fc.integer({ min: 0, max: 600 }),
        time: fc.constantFrom(0, 0, 1500, 3000),
        seedPrices: fc.array(fc.option(fc.integer({ min: 50, max: 2000 }), { freq: 4 }), {
          minLength: 25,
          maxLength: 25,
        }),
      })
      .map((x) => ({
        ...x,
        prices: Array.from({ length: x.items }, (_, i) =>
          x.stores.map((_, k) => x.seedPrices[(i * 5 + k) % 25] ?? null),
        ),
      }));
    fc.assert(
      fc.property(instance, (x) => {
        const ids = x.stores.map((_, k) => k + 1);
        const locations = new Map(x.stores.map((s, k) => [k + 1, at(s.dLat, s.dLng)]));
        const o = opts(locations, {
          maxStores: x.maxStores,
          fuelCentsPerGal: x.fuel,
          timeValueCentsPerHour: x.time,
        });
        const r = optimize(result(x.prices, ids), o);
        // Oracle: every subset, every assignment of each item to a store in the subset that has it.
        let oracle: { missing: number; total: number } | null = null;
        const subsets = (1 << ids.length) - 1;
        for (let mask = 1; mask <= subsets; mask++) {
          const s = ids.filter((_, k) => mask & (1 << k));
          if (s.length > x.maxStores) continue;
          const choices = x.prices.map((row) => s.filter((id) => row[id - 1] != null));
          const walk = (i: number, chosen: number[]) => {
            if (i === choices.length) {
              const used = [...new Set(chosen.filter((c) => c > 0))];
              const route = bestRoute(
                HOME,
                used.map((id) => ({ id, at: locations.get(id) ?? HOME })),
              );
              const items = chosen.reduce(
                (t, c, j) => t + (c > 0 ? (x.prices[j]?.[c - 1] ?? 0) : 0),
                0,
              );
              const fuel = fuelCostCents(route.miles, o.mpg, o.fuelCentsPerGal);
              const hours = (used.length * o.minutesPerStop) / 60 + route.miles / DRIVING_MPH;
              const time = roundHalfEven(o.timeValueCentsPerHour * hours);
              const cand = {
                missing: chosen.filter((c) => c === 0).length,
                total: items + fuel + time,
              };
              if (
                !oracle ||
                cand.missing < oracle.missing ||
                (cand.missing === oracle.missing && cand.total < oracle.total)
              )
                oracle = cand;
              return;
            }
            const opt = choices[i] ?? [];
            if (opt.length === 0) walk(i + 1, [...chosen, 0]);
            for (const c of opt) walk(i + 1, [...chosen, c]);
          };
          walk(0, []);
        }
        const b = best(r);
        if (x.items === 0) expect(b.totalCents).toBe(0);
        else {
          const want = oracle as { missing: number; total: number } | null;
          expect(want).not.toBeNull();
          expect({ missing: b.missing.length, total: b.totalCents }).toEqual(want);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('100 items × 10 stores × maxStores 3 runs in under 500 ms (p95 of 20 runs)', () => {
    const ids = Array.from({ length: 10 }, (_, k) => k + 1);
    const locations = new Map(ids.map((id) => [id, at(Math.sin(id) * 0.1, Math.cos(id) * 0.1)]));
    const prices = Array.from({ length: 100 }, (_, i) =>
      ids.map((id) => ((i * 7 + id * 13) % 11 === 0 ? null : 100 + ((i * 31 + id * 17) % 400))),
    );
    const input = result(prices, ids, 1);
    const times: number[] = [];
    for (let n = 0; n < 20; n++) {
      const t0 = performance.now();
      const r = optimize(input, opts(locations, { maxStores: 3 }));
      times.push(performance.now() - t0);
      expect(r.subsetsEvaluated).toBe(10 + 45 + 120);
    }
    times.sort((a, b) => a - b);
    expect(times[18] ?? Infinity).toBeLessThan(500);
  });
});

describe('recommendation threshold (Q-4: max($3, 3%))', () => {
  const plan = (totalCents: number, missing = 0, stores = 1): OptimizedPlan => ({
    storeIds: Array.from({ length: stores }, (_, k) => k + 1),
    route: [],
    assignments: [],
    missing: Array.from({ length: missing }, (_, k) => `m${String(k)}`),
    complete: missing === 0,
    itemsCents: totalCents,
    distanceMiles: 0,
    fuelCents: 0,
    timeCents: 0,
    totalCents,
    baselineCents: null,
    savingsVsBaselineCents: null,
  });

  it('uses $3 below $100 and 3% above it', () => {
    expect(multiThresholdCents(5_000)).toBe(300);
    expect(multiThresholdCents(10_000)).toBe(300);
    expect(multiThresholdCents(20_000)).toBe(600);
    expect(multiThresholdCents(12_345)).toBe(370); // 370.35
  });

  it('boundaries: exactly the threshold recommends the extra stop; one cent less does not', () => {
    expect(recommend(plan(5_000), plan(4_700, 0, 2))).toMatchObject({
      kind: 'multi',
      reason: 'saves_enough',
      extraStopSavingsCents: 300,
    });
    expect(recommend(plan(5_000), plan(4_701, 0, 2))).toMatchObject({
      kind: 'single',
      reason: 'not_worth_it',
      extraStopSavingsCents: 299,
    });
    expect(recommend(plan(20_000), plan(19_400, 0, 2)).kind).toBe('multi');
    expect(recommend(plan(20_000), plan(19_401, 0, 2)).kind).toBe('single');
    expect(recommend(plan(20_000), plan(20_500, 0, 2)).kind).toBe('single');
  });

  it('covering more items wins regardless of price; covering fewer never does', () => {
    expect(recommend(plan(5_000, 2), plan(9_000, 0, 2))).toMatchObject({
      kind: 'multi',
      reason: 'coverage',
    });
    expect(recommend(plan(9_000, 0), plan(1_000, 1, 2)).kind).toBe('single');
    expect(recommend(plan(9_000), undefined)).toMatchObject({
      kind: 'single',
      reason: 'only_option',
    });
  });
});
