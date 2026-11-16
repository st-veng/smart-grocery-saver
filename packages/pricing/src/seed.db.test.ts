/**
 * Phase 1 acceptance (SPEC §7): seed determinism, coverage, calibration and ingestion correctness,
 * against a database seeded once by test/global-setup.ts (seed 20261116, anchor 2026-11-01).
 */
import {
  addDays,
  coverCost,
  DEFAULT_ORIGIN,
  haversineMiles,
  packageBaseQuantity,
  PRESELECT_RADIUS_MILES,
  toBase,
  type CoverOption,
  type UnitCode,
} from '@sgs/core';
import { createDb, runMigrations, type DbHandle } from '@sgs/db';
import { recreateDatabase, testDatabaseUrl } from '@sgs/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FAMILY_WEEK } from './catalog/family-fixture.js';
import { applyDay } from './ingest/ingest.js';
import { MockPriceProvider } from './mock/mock-provider.js';
import { seedDatabase } from './seed/seed.js';

const SEED = '20261116';
const ANCHOR = '2026-11-01';
const FROM = addDays(ANCHOR, -364);

let h: DbHandle;
let second: Promise<{ url: string; ms: number }> | null = null;
/** A second, independently seeded database (same seed + anchor), created once per file. */
function secondSeed(): Promise<{ url: string; ms: number }> {
  second ??= (async () => {
    const url = testDatabaseUrl('pricing_det');
    await recreateDatabase(url);
    await runMigrations(url);
    const result = await seedDatabase({ url, seed: SEED, anchorDate: ANCHOR });
    return { url, ms: result.ms };
  })();
  return second;
}
const rows = async <T>(q: ReturnType<typeof sql>) => (await h.db.execute(q)).rows as T[];

beforeAll(() => {
  h = createDb(testDatabaseUrl('pricing'));
});
afterAll(async () => {
  await h.close();
});

/** Hash of every seeded row by natural keys (UUIDs and timestamps excluded). */
async function contentHash(handle: DbHandle): Promise<string> {
  const r = await handle.db.execute<{ h: string }>(sql`
    SELECT md5(
      (SELECT string_agg(concat_ws('|', s.slug, s.name, s.loyalty_program, s.requires_membership), ',' ORDER BY s.slug) FROM stores s) ||
      (SELECT string_agg(concat_ws('|', l.external_ref, l.lat, l.lng), ',' ORDER BY l.external_ref) FROM store_locations l) ||
      (SELECT string_agg(concat_ws('|', p.slug, p.dimension, p.display_unit, p.default_quantity, p.default_unit), ',' ORDER BY p.slug) FROM products p) ||
      (SELECT string_agg(concat_ws('|', s.slug, i.sku, i.upc, i.title, i.base_quantity, i.pricing_basis, p.slug, i.match_method), ',' ORDER BY s.slug, i.sku)
         FROM store_items i JOIN stores s ON s.id = i.store_id LEFT JOIN products p ON p.id = i.product_id) ||
      (SELECT string_agg(concat_ws('|', s.slug, i.sku, pp.valid_during, pp.regular_price_cents, pp.sale_price_cents, pp.promo_type, pp.promo_label, pp.min_qty, pp.member_only), ','
                         ORDER BY s.slug, i.sku, lower(pp.valid_during))
         FROM price_points pp JOIN store_items i ON i.id = pp.store_item_id JOIN stores s ON s.id = i.store_id)
    ) AS h`);
  return r.rows[0]?.h ?? '';
}

describe('seed', () => {
  it('is deterministic: same SEED + SEED_ANCHOR_DATE ⇒ identical rows, and finishes in < 60 s', async () => {
    const { url, ms } = await secondSeed();
    expect(ms).toBeLessThan(60_000);
    expect(Number(process.env.SGS_TEST_SEED_MS ?? 0)).toBeLessThan(60_000);
    const other = createDb(url);
    try {
      expect(await contentHash(other)).toBe(await contentHash(h));
    } finally {
      await other.close();
    }
  });

  it('has ≥150 products, 10 stores, every chain has items, every product at ≥4 chains', async () => {
    const [counts] = await rows<{ products: number; stores: number }>(sql`
      SELECT (SELECT count(*) FROM products)::int AS products, (SELECT count(*) FROM stores)::int AS stores`);
    expect(counts?.products).toBeGreaterThanOrEqual(150);
    expect(counts?.stores).toBe(10);
    const perStore = await rows<{ slug: string; n: number }>(sql`
      SELECT s.slug, count(i.id)::int AS n FROM stores s LEFT JOIN store_items i ON i.store_id = s.id AND i.product_id IS NOT NULL GROUP BY s.slug`);
    for (const s of perStore) expect(s.n, s.slug).toBeGreaterThan(30);
    const thin = await rows<{ slug: string; chains: number }>(sql`
      SELECT p.slug, count(DISTINCT i.store_id)::int AS chains FROM products p
      LEFT JOIN store_items i ON i.product_id = p.id GROUP BY p.slug HAVING count(DISTINCT i.store_id) < 4`);
    expect(thin).toEqual([]);
  });

  it('every store item has continuous price coverage over 365 days: no gaps, no overlaps, last period open', async () => {
    const bad = await rows<{ sku: string; problem: string }>(sql`
      WITH ordered AS (
        SELECT i.sku, pp.valid_during,
               lag(upper(pp.valid_during)) OVER w AS prev_upper,
               row_number() OVER w AS rn,
               count(*) OVER (PARTITION BY pp.store_item_id) AS n
        FROM price_points pp JOIN store_items i ON i.id = pp.store_item_id
        WINDOW w AS (PARTITION BY pp.store_item_id ORDER BY lower(pp.valid_during))
      )
      SELECT sku, CASE
          WHEN rn = 1 AND lower(valid_during) <> ${FROM}::date THEN 'starts late'
          WHEN rn > 1 AND lower(valid_during) <> prev_upper THEN 'gap/overlap'
          WHEN rn = n AND NOT upper_inf(valid_during) THEN 'not open'
          WHEN rn < n AND upper_inf(valid_during) THEN 'open early'
        END AS problem
      FROM ordered
      WHERE (rn = 1 AND lower(valid_during) <> ${FROM}::date)
         OR (rn > 1 AND lower(valid_during) <> prev_upper)
         OR (rn = n AND NOT upper_inf(valid_during))
         OR (rn < n AND upper_inf(valid_during))`);
    expect(bad).toEqual([]);
    const [missing] = await rows<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM store_items i WHERE NOT EXISTS (SELECT 1 FROM price_points pp WHERE pp.store_item_id = i.id)`);
    expect(missing?.n).toBe(0);
  });

  it("every chain except Trader Joe's has ≥1 sale in every month; Trader Joe's has none", async () => {
    const months = await rows<{ slug: string; month: string; sales: number }>(sql`
      SELECT s.slug, to_char(m, 'YYYY-MM') AS month,
             count(pp.id) FILTER (WHERE pp.sale_price_cents IS NOT NULL)::int AS sales
      FROM stores s
      CROSS JOIN generate_series(date_trunc('month', ${FROM}::date + 31), date_trunc('month', ${ANCHOR}::date - 1), interval '1 month') AS m
      LEFT JOIN store_items i ON i.store_id = s.id
      LEFT JOIN price_points pp ON pp.store_item_id = i.id
        AND pp.valid_during && daterange(m::date, (m + interval '1 month')::date)
      GROUP BY s.slug, m`);
    expect(months.length).toBe(10 * 11);
    for (const m of months) {
      if (m.slug === 'traderjoes') expect(m.sales, `${m.slug} ${m.month}`).toBe(0);
      else expect(m.sales, `${m.slug} ${m.month}`).toBeGreaterThan(0);
    }
  });

  it('Tom Thumb and Kroger have member-only (loyalty) prices every month', async () => {
    const r = await rows<{ slug: string; months: number }>(sql`
      SELECT s.slug, count(DISTINCT to_char(d, 'YYYY-MM'))::int AS months
      FROM stores s JOIN store_items i ON i.store_id = s.id
      JOIN price_points pp ON pp.store_item_id = i.id AND pp.member_only
      CROSS JOIN LATERAL generate_series(lower(pp.valid_during), LEAST(COALESCE(upper(pp.valid_during), ${ANCHOR}::date), ${ANCHOR}::date), interval '1 day') AS d
      WHERE s.slug IN ('tomthumb', 'kroger')
      GROUP BY s.slug ORDER BY s.slug`);
    expect(r).toEqual([
      { slug: 'kroger', months: 13 },
      { slug: 'tomthumb', months: 13 },
    ]);
  });

  it("models Sprouts' Wednesday double-ad day without overlapping periods", async () => {
    const [r] = await rows<{ eight_day_ads: number; overlaps: number }>(sql`
      SELECT
        (SELECT count(*)::int FROM price_points pp JOIN store_items i ON i.id = pp.store_item_id JOIN stores s ON s.id = i.store_id
          WHERE s.slug = 'sprouts' AND pp.sale_price_cents IS NOT NULL AND extract(isodow FROM lower(pp.valid_during)) = 3
            AND upper(pp.valid_during) - lower(pp.valid_during) = 8) AS eight_day_ads,
        (SELECT count(*)::int FROM price_points a JOIN price_points b
           ON a.store_item_id = b.store_item_id AND a.id < b.id AND a.valid_during && b.valid_during) AS overlaps`);
    expect(r?.eight_day_ads).toBeGreaterThan(0);
    expect(r?.overlaps).toBe(0);
  });

  it('places most chains within 7 mi of Main & Preston, Frisco, and at least one beyond', async () => {
    const locs = await rows<{ slug: string; lat: string; lng: string }>(sql`
      SELECT s.slug, l.lat::text, l.lng::text FROM store_locations l JOIN stores s ON s.id = l.store_id`);
    const nearest = new Map<string, number>();
    for (const l of locs) {
      const d = haversineMiles(DEFAULT_ORIGIN, { lat: Number(l.lat), lng: Number(l.lng) });
      nearest.set(l.slug, Math.min(d, nearest.get(l.slug) ?? Infinity));
    }
    const within = [...nearest].filter(([, d]) => d <= PRESELECT_RADIUS_MILES).map(([s]) => s);
    const beyond = [...nearest].filter(([, d]) => d > PRESELECT_RADIUS_MILES).map(([s]) => s);
    expect(within.length).toBeGreaterThanOrEqual(8);
    expect(beyond).toContain('traderjoes');
  });
});

describe('demo user (SPEC Phase 2)', () => {
  it('is onboarded at Main & Preston with Costco membership, no Sam’s, loyalty cards on, Kroger as usual store', async () => {
    const r = await rows<{
      slug: string;
      enabled: boolean;
      has_membership: boolean;
      has_loyalty: boolean;
      baseline: string;
      lat: string;
      onboarded: boolean;
    }>(sql`
      SELECT s.slug, us.enabled, us.has_membership, us.has_loyalty, b.slug AS baseline, u.home_lat::text AS lat,
             u.onboarded_at IS NOT NULL AS onboarded
      FROM users u JOIN user_stores us ON us.user_id = u.id JOIN stores s ON s.id = us.store_id
      JOIN stores b ON b.id = u.baseline_store_id
      WHERE u.email = 'demo@sgs.test' ORDER BY s.slug`);
    expect(r).toHaveLength(10);
    const by = (slug: string) => r.find((x) => x.slug === slug);
    expect(r[0]).toMatchObject({ baseline: 'kroger', onboarded: true });
    expect(Number(r[0]?.lat)).toBeCloseTo(33.15, 6);
    expect(by('costco')).toMatchObject({ has_membership: true, enabled: true });
    expect(by('sams')?.has_membership).toBe(false);
    expect(by('kroger')?.has_loyalty).toBe(true);
    expect(by('tomthumb')?.has_loyalty).toBe(true);
    expect(by('traderjoes')?.enabled).toBe(false);
  });
});

describe('ingestion correctness against provider ground truth', () => {
  const provider = new MockPriceProvider({ seed: SEED, anchorDate: ANCHOR });

  it('makes zero wrong matches; only planted unmatchable items are unmatched', async () => {
    const items = await rows<{
      store: string;
      sku: string;
      product: string | null;
      method: string | null;
    }>(sql`
      SELECT s.slug AS store, i.sku, p.slug AS product, i.match_method AS method
      FROM store_items i JOIN stores s ON s.id = i.store_id LEFT JOIN products p ON p.id = i.product_id`);
    const wrong = items.filter(
      (i) => i.product !== (provider.truth(i.store, i.sku)?.truthProduct ?? null),
    );
    expect(wrong).toEqual([]);
    const methods = new Set(items.map((i) => i.method));
    for (const m of ['upc', 'rule', 'fuzzy']) expect(methods, m).toContain(m);
    const unparseable = provider.allItems().filter((i) => i.truthSize === null).length;
    expect(provider.allItems().length - items.length).toBe(unparseable);
  });

  it('stores the true package size for every item (normalization round-trip)', async () => {
    const items = await rows<{ store: string; sku: string; base: string; basis: string }>(sql`
      SELECT s.slug AS store, i.sku, i.base_quantity::text AS base, i.pricing_basis AS basis
      FROM store_items i JOIN stores s ON s.id = i.store_id`);
    for (const i of items) {
      const t = provider.truth(i.store, i.sku)?.truthSize;
      if (!t) throw new Error(`no truth for ${i.store} ${i.sku}`);
      const expected = t.perWeight
        ? packageBaseQuantity(1, 1, t.unit)
        : packageBaseQuantity(t.packCount, t.unitQuantity, t.unit);
      expect(Number(i.base), `${i.store} ${i.sku}`).toBeCloseTo(expected, 3);
      expect(i.basis).toBe(t.perWeight ? 'per_weight' : 'per_package');
    }
  });

  it('applyDay(anchor + 1) keeps coverage contiguous, and re-applying is a no-op', async () => {
    // Mutates the second seeded copy; the determinism test (same file, runs first) already compared it.
    const { url } = await secondSeed();
    const other = createDb(url);
    try {
      const next = addDays(ANCHOR, 1);
      const first = await applyDay(other.db, provider, next, 'DFW');
      expect(first.closedAndOpened).toBeGreaterThan(0);
      expect(first.stale + first.opened).toBe(0);
      const again = await applyDay(other.db, provider, next, 'DFW');
      expect(again.closedAndOpened + again.opened + again.replaced).toBe(0);
      const [gaps] = (
        await other.db.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM (
            SELECT lower(valid_during) <> lag(upper(valid_during)) OVER (PARTITION BY store_item_id ORDER BY lower(valid_during)) AS gap
            FROM price_points) x WHERE gap`)
      ).rows;
      expect(gaps?.n).toBe(0);
    } finally {
      await other.close();
    }
  });
});

describe('calibration (SPEC §2.6)', () => {
  /** Median ratio of a chain's cheapest store-brand regular unit price to Kroger's, per product. */
  async function chainIndices() {
    return rows<{ slug: string; segment: string; median: number; n: number }>(sql`
      WITH cur AS (
        SELECT s.slug, i.product_id, c.slug AS cat,
               min(pp.regular_price_cents / i.base_quantity) AS unit
        FROM store_items i
        JOIN stores s ON s.id = i.store_id
        JOIN products p ON p.id = i.product_id
        JOIN categories c ON c.id = p.category_id
        JOIN price_points pp ON pp.store_item_id = i.id AND upper_inf(pp.valid_during)
        WHERE i.is_store_brand OR i.brand IS NULL
        GROUP BY s.slug, i.product_id, c.slug
      )
      SELECT x.slug,
             CASE WHEN x.slug = 'sprouts' AND x.cat = 'produce' THEN 'produce'
                  WHEN x.slug = 'sprouts' THEN 'other' ELSE 'all' END AS segment,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY (x.unit / k.unit)::float8) AS median,
             count(*)::int AS n
      FROM cur x JOIN cur k ON k.product_id = x.product_id AND k.slug = 'kroger'
      WHERE x.slug <> 'kroger'
      GROUP BY 1, 2 ORDER BY 1, 2`);
  }

  it('chain price indices fall inside the calibration table', async () => {
    const ranges: Record<string, [number, number]> = {
      'aldi/all': [0.8, 0.85],
      'walmart/all': [0.86, 0.9],
      'costco/all': [0.78, 0.84],
      'sams/all': [0.8, 0.86],
      'heb/all': [0.9, 0.95],
      'target/all': [1.03, 1.08],
      'tomthumb/all': [1.08, 1.12],
      'sprouts/produce': [0.88, 0.94],
      'sprouts/other': [1.04, 1.1],
      'traderjoes/all': [0.9, 0.95],
    };
    const got = await chainIndices();
    expect(got.map((g) => `${g.slug}/${g.segment}`).sort()).toEqual(Object.keys(ranges).sort());
    for (const g of got) {
      const [lo, hi] = ranges[`${g.slug}/${g.segment}`] ?? [0, 0];
      expect(g.median, `${g.slug}/${g.segment} median of ${g.n}`).toBeGreaterThanOrEqual(lo);
      expect(g.median, `${g.slug}/${g.segment} median of ${g.n}`).toBeLessThanOrEqual(hi);
    }
  });

  it('seasonality and shocks are visible: egg shock ≥ +30%, November turkey sales at ≥3 chains', async () => {
    const [eggs] = await rows<{ ratio: number }>(sql`
      SELECT (max(pp.regular_price_cents)::float8 / min(pp.regular_price_cents)) AS ratio
      FROM price_points pp JOIN store_items i ON i.id = pp.store_item_id JOIN stores s ON s.id = i.store_id
      JOIN products p ON p.id = i.product_id
      WHERE p.slug = 'large-eggs' AND s.slug = 'kroger' AND i.is_store_brand`);
    expect(eggs?.ratio).toBeGreaterThanOrEqual(1.3);
    const [turkey] = await rows<{ chains: number }>(sql`
      SELECT count(DISTINCT i.store_id)::int AS chains
      FROM price_points pp JOIN store_items i ON i.id = pp.store_item_id JOIN products p ON p.id = i.product_id
      WHERE p.slug = 'whole-turkey' AND pp.sale_price_cents IS NOT NULL
        AND pp.valid_during && daterange('2025-11-02', '2025-12-01')`);
    expect(turkey?.chains).toBeGreaterThanOrEqual(3);
  });

  it('family-week fixture: best ≤3-store plan saves 10–25% vs Kroger and vs Target (demo profile)', async () => {
    // Demo profile: Costco member, no Sam's, loyalty cards on ⇒ every member-only price applies.
    const offers = await rows<{
      store: string;
      product: string;
      item: string;
      basis: 'per_package' | 'per_weight';
      base: string;
      eff: number;
      regular: number;
      min_qty: number;
      item_dim: string;
      prod_dim: string;
      avg_each: string | null;
      def_q: string;
      def_u: UnitCode;
    }>(sql`
      SELECT s.slug AS store, p.slug AS product, i.sku AS item, i.pricing_basis AS basis, i.base_quantity::text AS base,
             pp.effective_price_cents AS eff, pp.regular_price_cents AS regular, pp.min_qty,
             unit_dim(i.unit)::text AS item_dim, p.dimension::text AS prod_dim, p.avg_each_grams::text AS avg_each,
             p.default_quantity::text AS def_q, p.default_unit::text AS def_u
      FROM store_items i JOIN stores s ON s.id = i.store_id JOIN products p ON p.id = i.product_id
      JOIN price_points pp ON pp.store_item_id = i.id AND upper_inf(pp.valid_during)
      WHERE s.slug <> 'sams' AND i.active`);

    const lineCost = new Map<string, Map<string, number>>(); // product → store → cents
    for (const line of FAMILY_WEEK) {
      const forProduct = offers.filter((o) => o.product === line.product);
      const first = forProduct[0];
      if (!first) throw new Error(`no offers for ${line.product}`);
      const needBase = line.unit
        ? toBase(line.quantity, line.unit)
        : line.quantity * toBase(Number(first.def_q), first.def_u);
      const byStore = new Map<string, CoverOption[]>();
      for (const o of forProduct) {
        let base = Number(o.base);
        if (o.item_dim !== o.prod_dim) {
          const avg = Number(o.avg_each);
          base = o.item_dim === 'mass' ? base / avg : base * avg; // express in the product's dimension
        }
        const list = byStore.get(o.store) ?? [];
        list.push({
          id: o.item,
          basis: o.basis,
          baseQuantity: base,
          priceCents: o.eff,
          regularPriceCents: o.regular,
          minQty: o.min_qty,
        });
        byStore.set(o.store, list);
      }
      const costs = new Map<string, number>();
      for (const [store, opts] of byStore) {
        const r = coverCost(needBase, opts);
        if (r) costs.set(store, r.costCents);
      }
      lineCost.set(line.product, costs);
    }

    const total = (stores: readonly string[]): number | null => {
      let sum = 0;
      for (const costs of lineCost.values()) {
        const best = Math.min(...stores.map((s) => costs.get(s) ?? Infinity));
        if (!Number.isFinite(best)) return null;
        sum += best;
      }
      return sum;
    };
    const chains = [
      'walmart',
      'costco',
      'target',
      'kroger',
      'heb',
      'aldi',
      'tomthumb',
      'sprouts',
      'traderjoes',
    ];
    let best = Infinity;
    for (let a = 0; a < chains.length; a++)
      for (let b = a; b < chains.length; b++)
        for (let c = b; c < chains.length; c++) {
          const t = total(
            [...new Set([chains[a], chains[b], chains[c]])].filter((x): x is string => !!x),
          );
          if (t !== null) best = Math.min(best, t);
        }
    const kroger = total(['kroger']);
    const target = total(['target']);
    expect(kroger).not.toBeNull();
    expect(target).not.toBeNull();
    const savingsVsKroger = 1 - best / (kroger ?? 1);
    const savingsVsTarget = 1 - best / (target ?? 1);
    console.info(
      `family week: best ≤3-store $${(best / 100).toFixed(2)}, Kroger $${((kroger ?? 0) / 100).toFixed(2)} ` +
        `(${(savingsVsKroger * 100).toFixed(1)}%), Target $${((target ?? 0) / 100).toFixed(2)} (${(savingsVsTarget * 100).toFixed(1)}%)`,
    );
    expect(savingsVsKroger).toBeGreaterThanOrEqual(0.1);
    expect(savingsVsKroger).toBeLessThanOrEqual(0.25);
    expect(savingsVsTarget).toBeGreaterThanOrEqual(0.1);
    expect(savingsVsTarget).toBeLessThanOrEqual(0.25);
  });
});
