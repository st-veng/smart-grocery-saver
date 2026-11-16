/** Seeds OUR catalog data: categories, canonical products, aliases. */
import { type Dimension, type UnitCode } from '@sgs/core';
import { categories, productAliases, products, type Db } from '@sgs/db';
import { AISLES, DEPARTMENTS } from '../catalog/categories.js';
import { PRODUCTS, type ProductSpec } from '../catalog/products.js';
import { parseSpecSize, productDimension } from '../mock/assortment.js';

const FRESH_LB: readonly string[] = ['produce', 'meat', 'seafood'];

export function displayUnitFor(spec: ProductSpec, dim: Dimension): UnitCode {
  if (spec.disp) return spec.disp;
  if (dim === 'mass') return spec.byWeight || FRESH_LB.includes(spec.category) ? 'lb' : 'oz';
  if (dim === 'volume') return 'fl_oz';
  return 'ea';
}

export function defaultSizeFor(spec: ProductSpec): { quantity: number; unit: UnitCode } {
  if (spec.byWeight) return { quantity: 1, unit: 'lb' };
  const s = parseSpecSize(spec, spec.sizes[0] ?? '');
  return { quantity: Math.round(s.packCount * s.unitQuantity * 1000) / 1000, unit: s.unit };
}

export async function seedCatalog(
  db: Db,
): Promise<{ categories: number; products: number; aliases: number }> {
  const catIds = new Map<string, number>();
  let order = 0;
  for (const c of [...DEPARTMENTS, ...AISLES]) {
    const parentId = c.parent ? catIds.get(c.parent) : undefined;
    const [row] = await db
      .insert(categories)
      .values({
        slug: c.slug,
        name: c.name,
        icon: c.icon,
        parentId: parentId ?? null,
        sortOrder: order++,
      })
      .returning({ id: categories.id });
    if (row) catIds.set(c.slug, row.id);
  }

  const seen = new Set<string>();
  const productRows = PRODUCTS.map((spec) => {
    if (seen.has(spec.slug)) throw new Error(`duplicate product slug ${spec.slug}`);
    seen.add(spec.slug);
    const dim = productDimension(spec);
    const def = defaultSizeFor(spec);
    const categoryId = catIds.get(spec.category);
    if (categoryId === undefined) throw new Error(`unknown category ${spec.category}`);
    return {
      slug: spec.slug,
      name: spec.name,
      categoryId,
      dimension: dim,
      displayUnit: displayUnitFor(spec, dim),
      defaultQuantity: def.quantity,
      defaultUnit: def.unit,
      avgEachGrams: spec.avgEach ?? null,
      attributes: { ...(spec.attrs ?? {}) },
    };
  });
  const inserted = await db
    .insert(products)
    .values(productRows)
    .returning({ id: products.id, slug: products.slug });
  const idBySlug = new Map(inserted.map((r) => [r.slug, r.id]));

  const aliasRows: { productId: string; alias: string }[] = [];
  const aliasSeen = new Set<string>();
  for (const spec of PRODUCTS) {
    for (const alias of spec.aliases ?? []) {
      const key = alias.toLowerCase();
      if (aliasSeen.has(key)) throw new Error(`duplicate alias "${alias}" (${spec.slug})`);
      aliasSeen.add(key);
      const productId = idBySlug.get(spec.slug);
      if (productId) aliasRows.push({ productId, alias });
    }
  }
  if (aliasRows.length) await db.insert(productAliases).values(aliasRows);
  return { categories: catIds.size, products: inserted.length, aliases: aliasRows.length };
}
