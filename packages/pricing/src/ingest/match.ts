/** Product matching (SPEC §2.4): UPC → rule (provider hint) → fuzzy (pg_trgm) → review queue. */
import type { Dimension } from '@sgs/core';
import { products, storeItems, type Db } from '@sgs/db';
import { and, isNotNull, sql } from 'drizzle-orm';
import type { NormalizedItem } from './normalize.js';

export const FUZZY_MIN_SCORE = 0.55;
export const FUZZY_MIN_MARGIN = 0.1;

export interface ProductRef {
  readonly id: string;
  readonly slug: string;
  readonly dimension: Dimension;
  readonly avgEachGrams: number | null;
}

export interface MatchResult {
  readonly product: ProductRef;
  readonly method: 'upc' | 'rule' | 'fuzzy';
  readonly confidence: number;
}

export function dimensionCompatible(
  product: ProductRef,
  candidates: readonly Dimension[],
): boolean {
  return candidates.some(
    (d) =>
      d === product.dimension ||
      (product.avgEachGrams !== null &&
        (d === 'mass' || d === 'count') &&
        (product.dimension === 'mass' || product.dimension === 'count')),
  );
}

export class Matcher {
  private readonly bySlug = new Map<string, ProductRef>();
  private readonly byId = new Map<string, ProductRef>();
  private readonly byUpc = new Map<string, string>();

  private constructor(private readonly db: Db) {}

  static async create(db: Db): Promise<Matcher> {
    const m = new Matcher(db);
    const rows = await db
      .select({
        id: products.id,
        slug: products.slug,
        dimension: products.dimension,
        avgEachGrams: products.avgEachGrams,
      })
      .from(products);
    for (const r of rows) {
      m.bySlug.set(r.slug, r);
      m.byId.set(r.id, r);
    }
    const upcs = await db
      .select({ upc: storeItems.upc, productId: storeItems.productId })
      .from(storeItems)
      .where(and(isNotNull(storeItems.upc), isNotNull(storeItems.productId)));
    for (const u of upcs) if (u.upc && u.productId) m.byUpc.set(u.upc, u.productId);
    return m;
  }

  /** Remember a UPC → product mapping learned during this run. */
  learnUpc(upc: string | null, productId: string): void {
    if (upc && !this.byUpc.has(upc)) this.byUpc.set(upc, productId);
  }

  async match(n: NormalizedItem): Promise<MatchResult | null> {
    if (n.candidateDimensions.length === 0) return null;
    const upcProduct = n.item.upc ? this.byUpc.get(n.item.upc) : undefined;
    const viaUpc = upcProduct ? this.byId.get(upcProduct) : undefined;
    if (viaUpc && dimensionCompatible(viaUpc, n.candidateDimensions)) {
      return { product: viaUpc, method: 'upc', confidence: 1 };
    }
    const viaRule = n.item.productHint ? this.bySlug.get(n.item.productHint) : undefined;
    if (viaRule && dimensionCompatible(viaRule, n.candidateDimensions)) {
      return { product: viaRule, method: 'rule', confidence: 0.95 };
    }
    return this.fuzzy(n);
  }

  private async fuzzy(n: NormalizedItem): Promise<MatchResult | null> {
    if (n.matchText.length < 3) return null;
    const res = await this.db.execute<{ id: string; score: number }>(sql`
      SELECT p.id, GREATEST(similarity(p.name, ${n.matchText}), COALESCE(MAX(similarity(a.alias, ${n.matchText})), 0))::float8 AS score
      FROM products p LEFT JOIN product_aliases a ON a.product_id = p.id
      GROUP BY p.id
      ORDER BY score DESC
      LIMIT 10`);
    const ranked = res.rows
      .map((r) => ({ ref: this.byId.get(r.id), score: r.score }))
      .filter(
        (r): r is { ref: ProductRef; score: number } =>
          r.ref !== undefined && dimensionCompatible(r.ref, n.candidateDimensions),
      );
    const [best, second] = ranked;
    if (!best || best.score < FUZZY_MIN_SCORE) return null;
    if (second && best.score - second.score < FUZZY_MIN_MARGIN) return null;
    return {
      product: best.ref,
      method: 'fuzzy',
      confidence: Math.min(0.94, Math.round(best.score * 1000) / 1000),
    };
  }
}
