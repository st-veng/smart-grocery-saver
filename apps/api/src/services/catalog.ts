import { dimensionOf, type UnitCode } from '@sgs/core';
import { categories, productAliases, type Db } from '@sgs/db';
import type { Category, ProductSummary } from '@sgs/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { AppError } from '../errors.js';

const PRODUCT_COLUMNS = sql`
  p.id, p.slug, p.name, p.category_id AS "categoryId", c.name AS "categoryName", p.dimension::text AS dimension,
  p.display_unit::text AS "displayUnit", p.default_quantity::float8 AS "defaultQuantity",
  p.default_unit::text AS "defaultUnit", p.avg_each_grams::float8 AS "avgEachGrams"`;

export async function listCategories(db: Db): Promise<Category[]> {
  return db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      parentId: categories.parentId,
      icon: categories.icon,
      sortOrder: categories.sortOrder,
    })
    .from(categories)
    .orderBy(asc(categories.sortOrder));
}

export async function productsByIds(
  db: Db,
  ids: readonly string[],
): Promise<Map<string, ProductSummary>> {
  if (ids.length === 0) return new Map();
  const r = await db.execute<ProductSummary>(sql`
    SELECT ${PRODUCT_COLUMNS} FROM products p JOIN categories c ON c.id = p.category_id
    WHERE p.id = ANY(ARRAY[${sql.join(
      ids.map((i) => sql`${i}`),
      sql`, `,
    )}]::uuid[])`);
  return new Map(r.rows.map((p) => [p.id, p]));
}

export async function getProduct(
  db: Db,
  id: string,
): Promise<{ product: ProductSummary; aliases: string[] }> {
  const product = (await productsByIds(db, [id])).get(id);
  if (!product) throw new AppError('NOT_FOUND', 404, 'Product not found');
  const aliases = await db
    .select({ alias: productAliases.alias })
    .from(productAliases)
    .where(eq(productAliases.productId, id))
    .orderBy(asc(productAliases.alias));
  return { product, aliases: aliases.map((a) => a.alias) };
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Typeahead search over names and aliases (trigram + prefix boosts). Offset cursor. */
export async function searchProducts(
  db: Db,
  opts: { q?: string | undefined; categoryId?: number | undefined; limit: number; cursor: number },
): Promise<{ products: ProductSummary[]; nextCursor: string | null }> {
  const q = opts.q?.trim().toLowerCase() ?? '';
  const catFilter =
    opts.categoryId !== undefined ? sql`AND p.category_id = ${opts.categoryId}` : sql``;
  const take = opts.limit + 1;
  let rows: ProductSummary[];
  if (q === '') {
    rows = (
      await db.execute<ProductSummary>(sql`
        SELECT ${PRODUCT_COLUMNS} FROM products p JOIN categories c ON c.id = p.category_id
        WHERE true ${catFilter}
        ORDER BY c.sort_order, p.name LIMIT ${take} OFFSET ${opts.cursor}`)
    ).rows;
  } else {
    const like = likeEscape(q);
    rows = (
      await db.execute<ProductSummary>(sql`
        SELECT * FROM (
          SELECT ${PRODUCT_COLUMNS},
            GREATEST(similarity(lower(p.name), ${q}), word_similarity(${q}, lower(p.name)),
                     COALESCE(MAX(word_similarity(${q}, lower(a.alias))), 0))
            + CASE WHEN lower(p.name) LIKE ${`${like}%`} THEN 0.5
                   WHEN lower(p.name) LIKE ${`% ${like}%`} THEN 0.3
                   WHEN bool_or(lower(a.alias) LIKE ${`${like}%`}) THEN 0.3
                   WHEN lower(p.name) LIKE ${`%${like}%`} THEN 0.1 ELSE 0 END AS score
          FROM products p JOIN categories c ON c.id = p.category_id
          LEFT JOIN product_aliases a ON a.product_id = p.id
          WHERE true ${catFilter}
          GROUP BY p.id, c.name
        ) ranked
        WHERE score >= 0.3
        ORDER BY score DESC, name LIMIT ${take} OFFSET ${opts.cursor}`)
    ).rows.map((r) => {
      const { score: _score, ...rest } = r as ProductSummary & { score: number };
      return rest;
    });
  }
  const more = rows.length > opts.limit;
  return {
    products: rows.slice(0, opts.limit),
    nextCursor: more ? String(opts.cursor + opts.limit) : null,
  };
}

// ───────────── free-text → product matching (lists, import) ─────────────
export const MATCH_MIN_SCORE = 0.6;
export const MATCH_MIN_MARGIN = 0.15;
export const CANDIDATE_MIN_SCORE = 0.3;

export interface MatchOutcome {
  readonly status: 'matched' | 'ambiguous' | 'unmatched';
  readonly productId: string | null;
  readonly candidates: { productId: string; name: string; score: number }[];
}

function variants(name: string): string[] {
  const q = name
    .toLowerCase()
    .replace(/[^a-z0-9%&/' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const out = new Set([q]);
  if (q.endsWith('ies') && q.length > 4) out.add(`${q.slice(0, -3)}y`);
  else if (q.endsWith('es') && q.length > 4) out.add(q.slice(0, -2));
  if (q.endsWith('s') && q.length > 3) out.add(q.slice(0, -1));
  return [...out].filter(Boolean);
}

/**
 * Match a free-text item name to one canonical product. Exact name/alias wins; otherwise a trigram
 * match must clear MATCH_MIN_SCORE and beat the runner-up by MATCH_MIN_MARGIN. Anything less is
 * 'ambiguous' (with candidates) or 'unmatched' — never guessed.
 */
export async function matchProductName(db: Db, name: string): Promise<MatchOutcome> {
  const qs = variants(name);
  if (qs.length === 0 || (qs[0]?.length ?? 0) < 2)
    return { status: 'unmatched', productId: null, candidates: [] };
  const arr = sql`ARRAY[${sql.join(
    qs.map((q) => sql`${q}`),
    sql`, `,
  )}]::text[]`;
  const r = await db.execute<{ id: string; name: string; score: number; exact: boolean }>(sql`
    SELECT p.id, p.name,
      MAX(GREATEST(similarity(lower(p.name), q), word_similarity(q, lower(p.name)) * 0.95,
                   COALESCE(similarity(lower(a.alias), q), 0)))::float8 AS score,
      COALESCE(bool_or(lower(p.name) = q OR lower(a.alias) IS NOT DISTINCT FROM q), false) AS exact
    FROM products p LEFT JOIN product_aliases a ON a.product_id = p.id
    CROSS JOIN unnest(${arr}) AS q
    GROUP BY p.id
    ORDER BY exact DESC, score DESC
    LIMIT 5`);
  const rows = r.rows.map((x) => ({ ...x, score: Math.round(x.score * 1000) / 1000 }));
  const [best, second] = rows;
  if (!best) return { status: 'unmatched', productId: null, candidates: [] };
  if (best.exact)
    return {
      status: 'matched',
      productId: best.id,
      candidates: [{ productId: best.id, name: best.name, score: 1 }],
    };
  const candidates = rows
    .filter((x) => x.score >= CANDIDATE_MIN_SCORE)
    .slice(0, 3)
    .map((x) => ({ productId: x.id, name: x.name, score: x.score }));
  if (best.score >= MATCH_MIN_SCORE && (!second || best.score - second.score >= MATCH_MIN_MARGIN)) {
    return { status: 'matched', productId: best.id, candidates };
  }
  return candidates.length > 0
    ? { status: 'ambiguous', productId: null, candidates }
    : { status: 'unmatched', productId: null, candidates: [] };
}

/**
 * Fit a list unit to a product: same dimension stays; a bare "oz" on a liquid becomes fl_oz;
 * count↔mass is kept when the product has an average weight; anything else is dropped (null =
 * "packages") rather than stored as a nonsense quantity.
 */
export function fitUnit(
  unit: UnitCode | null,
  product: Pick<ProductSummary, 'dimension' | 'avgEachGrams'>,
): UnitCode | null {
  if (unit === null) return null;
  const d = dimensionOf(unit);
  if (d === product.dimension) return unit;
  if (unit === 'oz' && product.dimension === 'volume') return 'fl_oz';
  if (product.avgEachGrams !== null && d !== 'volume' && product.dimension !== 'volume')
    return unit;
  return null;
}
