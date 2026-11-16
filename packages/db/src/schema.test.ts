import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNIT_CODES, UNITS } from '@sgs/core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recreateDatabase, testDatabaseUrl } from './testing.js';
import { runMigrations } from './migrate.js';

const REFERENCE_DDL = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/schema.sql',
);

/** Name-independent description of the public schema, for diffing two databases. */
async function catalog(client: pg.Client) {
  const q = async (text: string) => (await client.query(text)).rows as Record<string, unknown>[];
  return {
    columns: await q(`
      SELECT table_name, column_name, udt_name, is_nullable, is_generated, column_default,
             generation_expression, numeric_precision, numeric_scale, character_maximum_length, is_identity
      FROM information_schema.columns WHERE table_schema = 'public'
      ORDER BY table_name, column_name`),
    enums: await q(`
      SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder)::text AS labels
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname ORDER BY t.typname`),
    constraints: await q(`
      SELECT conrelid::regclass::text AS table_name, contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype IN ('c','f','p','u','x')
      ORDER BY 1, 2, 3`),
    indexes: await q(`
      SELECT tablename, regexp_replace(indexdef, 'INDEX \\S+ ON', 'INDEX ON') AS def
      FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    triggers: await q(`
      SELECT event_object_table, trigger_name, event_manipulation, action_timing
      FROM information_schema.triggers WHERE trigger_schema = 'public' ORDER BY 1, 2, 3`),
    functions: await q(`
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.provolatile, p.prosrc
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
      ORDER BY 1, 2`),
  };
}

let fromMigrations: pg.Client;
let fromReference: pg.Client;

beforeAll(async () => {
  const migratedUrl = testDatabaseUrl('db_migrated');
  const referenceUrl = testDatabaseUrl('db_reference');
  await recreateDatabase(migratedUrl);
  await recreateDatabase(referenceUrl);
  await runMigrations(migratedUrl);
  fromMigrations = new pg.Client({ connectionString: migratedUrl });
  fromReference = new pg.Client({ connectionString: referenceUrl });
  await fromMigrations.connect();
  await fromReference.connect();
  await fromReference.query(fs.readFileSync(REFERENCE_DDL, 'utf8'));
});

afterAll(async () => {
  await fromMigrations.end();
  await fromReference.end();
});

describe('schema parity: Drizzle migrations vs docs/schema.sql (SPEC Appendix A)', () => {
  it('has identical columns, enums, constraints, indexes, triggers and functions', async () => {
    const [a, b] = await Promise.all([catalog(fromMigrations), catalog(fromReference)]);
    expect(a.columns).toEqual(b.columns);
    expect(a.enums).toEqual(b.enums);
    expect(a.constraints).toEqual(b.constraints);
    expect(a.indexes).toEqual(b.indexes);
    expect(a.triggers).toEqual(b.triggers);
    expect(a.functions).toEqual(b.functions);
  });
});

describe('unit_factor() / unit_dim() parity with @sgs/core', () => {
  it('matches the TypeScript unit table exactly', async () => {
    const res = await fromMigrations.query<{ u: string; factor: string; dim: string }>(
      `SELECT u::text, unit_factor(u)::text AS factor, unit_dim(u)::text AS dim
       FROM unnest(enum_range(NULL::unit_code)) AS u`,
    );
    expect(res.rows.map((r) => r.u)).toEqual([...UNIT_CODES]);
    for (const row of res.rows) {
      const def = UNITS[row.u as keyof typeof UNITS];
      expect(Number(row.factor), row.u).toBe(def.factor);
      expect(row.dim, row.u).toBe(def.dimension);
    }
  });
});

describe('constraints reject bad data', () => {
  let storeId: number;
  let volumeProductId: string;
  let itemId: string;

  beforeAll(async () => {
    const c = fromMigrations;
    storeId = (
      await c.query<{ id: number }>(
        `INSERT INTO stores (slug, name, brand_color) VALUES ('kroger','Kroger','#0D4C9C') RETURNING id`,
      )
    ).rows[0]!.id;
    const cat = (
      await c.query<{ id: number }>(
        `INSERT INTO categories (slug, name) VALUES ('drinks','Drinks') RETURNING id`,
      )
    ).rows[0]!.id;
    volumeProductId = (
      await c.query<{ id: string }>(
        `INSERT INTO products (slug, name, category_id, dimension, display_unit, default_quantity, default_unit)
         VALUES ('cola','Cola',$1,'volume','fl_oz',12,'fl_oz') RETURNING id`,
        [cat],
      )
    ).rows[0]!.id;
    itemId = (
      await c.query<{ id: string }>(
        `INSERT INTO store_items (store_id, product_id, sku, title, pack_count, unit_quantity, unit, match_method)
         VALUES ($1,$2,'k1','Cola 12 x 12 fl oz',12,12,'fl_oz','rule') RETURNING id`,
        [storeId, volumeProductId],
      )
    ).rows[0]!.id;
  });

  it('computes base_quantity for multi-packs', async () => {
    const r = await fromMigrations.query<{ b: string }>(
      `SELECT base_quantity::text AS b FROM store_items WHERE id = $1`,
      [itemId],
    );
    expect(Number(r.rows[0]!.b)).toBeCloseTo(4258.5883, 4);
  });

  it('rejects a mass unit on a volume product (dimension trigger)', async () => {
    await expect(
      fromMigrations.query(
        `INSERT INTO store_items (store_id, product_id, sku, title, unit_quantity, unit, match_method)
         VALUES ($1,$2,'k2','bad',1,'lb','rule')`,
        [storeId, volumeProductId],
      ),
    ).rejects.toThrow(/incompatible with product cola/);
  });

  it('rejects overlapping price periods but accepts adjacent ones', async () => {
    const insert = (range: string, regular: number, sale: number | null = null) =>
      fromMigrations.query(
        `INSERT INTO price_points (store_item_id, valid_during, regular_price_cents, sale_price_cents, promo_type, source)
         VALUES ($1, $2::daterange, $3, $4, $5, 'test')`,
        [itemId, range, regular, sale, sale === null ? 'none' : 'sale'],
      );
    await insert('[2026-01-01,2026-01-08)', 599);
    await expect(insert('[2026-01-05,)', 549)).rejects.toThrow(/price_points_no_overlap/);
    await insert('[2026-01-08,)', 599, 449);
    const r = await fromMigrations.query<{ eff: number; cur: boolean }>(
      `SELECT effective_price_cents AS eff, upper_inf(valid_during) AS cur FROM price_points
       WHERE store_item_id = $1 ORDER BY lower(valid_during)`,
      [itemId],
    );
    expect(r.rows).toEqual([
      { eff: 599, cur: false },
      { eff: 449, cur: true },
    ]);
  });

  it('rejects a sale price that is not below regular', async () => {
    await expect(
      fromMigrations.query(
        `INSERT INTO price_points (store_item_id, valid_during, regular_price_cents, sale_price_cents, promo_type, source)
         VALUES ($1, '[2027-01-01,2027-01-02)', 300, 300, 'sale', 'test')`,
        [itemId],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('rejects per-weight items that are not 1 × 1 mass unit', async () => {
    await expect(
      fromMigrations.query(
        `INSERT INTO store_items (store_id, sku, title, unit_quantity, unit, pricing_basis)
         VALUES ($1,'k3','x',2,'lb','per_weight')`,
        [storeId],
      ),
    ).rejects.toThrow(/store_items_per_weight_check/);
  });
});
