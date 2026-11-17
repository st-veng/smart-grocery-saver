/** Price comparison for a list, and per-product offers (SPEC Phase 4). */
import {
  bridgeBase,
  compareList,
  dimensionOf,
  effectivePrice,
  fromBase,
  unitPriceCents,
  type CompareLine,
  type CompareProduct,
  type CompareStore,
  type IsoDate,
  type Offer,
  type StoreSettings,
  type UnitCode,
} from '@sgs/core';
import { listItems, stores, users, type Db } from '@sgs/db';
import type { ComparisonResponse, ProductOffersResponse, ProductSummary } from '@sgs/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { AppError } from '../errors.js';
import { productsByIds } from './catalog.js';
import { ownedList } from './lists.js';
import { myStores } from './stores.js';

interface StoreRow extends CompareStore {
  readonly brandColor: string;
}

/** Stores plus the user's effective settings (saved, or the onboarding defaults until saved). */
async function storesFor(db: Db, userId: string, radiusMiles: number) {
  const rows: StoreRow[] = await db
    .select({
      id: stores.id,
      slug: stores.slug,
      name: stores.name,
      sortOrder: stores.sortOrder,
      requiresMembership: stores.requiresMembership,
      loyaltyProgram: stores.loyaltyProgram,
      brandColor: stores.brandColor,
    })
    .from(stores)
    .orderBy(asc(stores.sortOrder));
  const mine = await myStores(db, userId, radiusMiles);
  const settings = new Map<number, StoreSettings>(
    mine.stores.map((s) => [
      s.id,
      { enabled: s.enabled, hasMembership: s.hasMembership, hasLoyalty: s.hasLoyalty },
    ]),
  );
  return { rows, settings };
}

type OfferRow = Offer & {
  readonly packCount: number;
  readonly unitQuantity: number;
};

/** Every active store item for these products with its price period on `asOf` (metro-wide prices). */
async function offersAt(
  db: Db,
  productIds: readonly string[],
  asOf: IsoDate,
  metro: string,
): Promise<OfferRow[]> {
  if (productIds.length === 0) return [];
  const r = await db.execute<OfferRow & Record<string, unknown>>(sql`
    SELECT si.id AS "storeItemId", si.store_id AS "storeId", si.product_id AS "productId", si.title, si.brand,
           si.is_store_brand AS "isStoreBrand", si.pricing_basis::text AS basis,
           (CASE WHEN si.pricing_basis = 'per_weight' THEN unit_factor(si.unit) ELSE si.base_quantity END)::float8 AS "baseQuantity",
           si.unit::text AS unit, si.pack_count AS "packCount", si.unit_quantity::float8 AS "unitQuantity",
           pp.regular_price_cents AS "regularPriceCents", pp.sale_price_cents AS "salePriceCents",
           pp.promo_label AS "promoLabel", pp.min_qty AS "minQty", pp.member_only AS "memberOnly"
    FROM store_items si
    JOIN price_points pp ON pp.store_item_id = si.id
      AND pp.valid_during @> ${asOf}::date AND pp.metro = ${metro} AND pp.store_location_id IS NULL
    WHERE si.active AND si.product_id = ANY(ARRAY[${sql.join(
      productIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::uuid[])`);
  return r.rows;
}

const toCompareProduct = (p: ProductSummary): CompareProduct => ({
  id: p.id,
  name: p.name,
  dimension: p.dimension,
  displayUnit: p.displayUnit,
  defaultQuantity: p.defaultQuantity,
  defaultUnit: p.defaultUnit,
  avgEachGrams: p.avgEachGrams,
});

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export async function compareListForUser(
  db: Db,
  userId: string,
  listId: string,
  opts: {
    asOf: IsoDate;
    storeIds?: readonly number[] | undefined;
    radiusMiles: number;
    metro: string;
  },
): Promise<ComparisonResponse> {
  const list = await ownedList(db, userId, listId);
  const items = await db
    .select()
    .from(listItems)
    .where(eq(listItems.listId, listId))
    .orderBy(asc(listItems.position), asc(listItems.createdAt));
  const productIds = [...new Set(items.flatMap((i) => (i.productId ? [i.productId] : [])))];
  const [prods, { rows: storeRows, settings }, offers, [user]] = await Promise.all([
    productsByIds(db, productIds),
    storesFor(db, userId, opts.radiusMiles),
    offersAt(db, productIds, opts.asOf, opts.metro),
    db.select({ baselineStoreId: users.baselineStoreId }).from(users).where(eq(users.id, userId)),
  ]);

  const lines: CompareLine[] = items.map((i) => {
    const p = i.productId ? prods.get(i.productId) : undefined;
    return {
      itemId: i.id,
      product: p ? toCompareProduct(p) : null,
      quantity: i.quantity,
      unit: i.unit,
      matchMode: i.matchMode,
      brand: i.brand,
      storeItemId: i.storeItemId,
    };
  });
  const result = compareList({
    lines,
    stores: storeRows,
    settings,
    offers,
    baselineStoreId: user?.baselineStoreId ?? null,
    onlyStoreIds: opts.storeIds,
  });
  const eligibleOrSelected = new Set([
    ...result.stores.map((s) => s.storeId),
    ...result.excluded.filter((e) => e.reason === 'not_selected').map((e) => e.storeId),
  ]);

  return {
    listId: list.id,
    listName: list.name,
    asOf: opts.asOf,
    stores: storeRows.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      brandColor: s.brandColor,
      requiresMembership: s.requiresMembership,
      loyaltyProgram: s.loyaltyProgram,
    })),
    available: storeRows
      .filter((s) => eligibleOrSelected.has(s.id))
      .map((s) => ({ storeId: s.id, included: result.stores.some((t) => t.storeId === s.id) })),
    excluded: result.excluded,
    totals: result.stores,
    lines: result.lines.map((l, idx) => {
      const item = items[idx];
      if (!item) throw new Error('line/item mismatch');
      const p = item.productId ? (prods.get(item.productId) ?? null) : null;
      const toDisplay = (base: number) => (p ? round4(fromBase(base, p.displayUnit)) : base);
      return {
        itemId: l.itemId,
        rawText: item.rawText,
        product: p,
        quantity: item.quantity,
        unit: item.unit,
        checked: item.checked,
        unpriced: l.unpriced,
        need: l.needBase === null ? null : toDisplay(l.needBase),
        cheapestStoreIds: l.cheapestStoreIds,
        stores: l.stores.map((s) => ({
          storeId: s.storeId,
          status: s.status,
          storeItemId: s.storeItemId,
          title: s.title,
          brand: s.brand,
          packages: s.packages,
          lineCents: s.lineCents,
          unitPriceCents: s.unitPriceCents === null ? null : round4(s.unitPriceCents),
          onSale: s.onSale,
          memberPrice: s.memberPrice,
          promoLabel: s.promoLabel,
          usedMultiBuy: s.usedMultiBuy,
          approximate: s.approximate,
          overbuy: toDisplay(s.overbuyBase),
        })),
      };
    }),
    cheapestStoreId: result.cheapestStoreId,
    cheapestWithMissingStoreId: result.cheapestWithMissingStoreId,
    baseline: result.baseline,
    savingsPct: result.savingsPct,
    savingsCents: result.savingsCents,
    unpricedCount: result.unpricedCount,
  };
}

const UNIT_WORD: Record<UnitCode, string> = {
  g: 'g',
  kg: 'kg',
  oz: 'oz',
  lb: 'lb',
  ml: 'mL',
  l: 'L',
  fl_oz: 'fl oz',
  pt: 'pt',
  qt: 'qt',
  gal: 'gal',
  ea: 'ct',
  dozen: 'dozen',
};

function sizeLabel(o: OfferRow): string {
  if (o.basis === 'per_weight') return `per ${UNIT_WORD[o.unit]}`;
  const one = `${String(round4(o.unitQuantity))} ${UNIT_WORD[o.unit]}`;
  return o.packCount > 1 ? `${String(o.packCount)} × ${one}` : one;
}

/** Current offers for one product at the user's eligible stores, cheapest unit price first. */
export async function productOffersForUser(
  db: Db,
  userId: string,
  productId: string,
  opts: { asOf: IsoDate; radiusMiles: number; metro: string },
): Promise<ProductOffersResponse> {
  const product = (await productsByIds(db, [productId])).get(productId);
  if (!product) throw new AppError('NOT_FOUND', 404, 'Product not found');
  const [{ rows: storeRows, settings }, offers] = await Promise.all([
    storesFor(db, userId, opts.radiusMiles),
    offersAt(db, [productId], opts.asOf, opts.metro),
  ]);
  const eligible = new Map(
    storeRows
      .filter((s) => {
        const st = settings.get(s.id);
        return st?.enabled && (!s.requiresMembership || st.hasMembership);
      })
      .map((s) => [s.id, s]),
  );
  const priced = offers.flatMap((o) => {
    const st = eligible.get(o.storeId);
    const s = settings.get(o.storeId);
    if (!st || !s) return [];
    const b = bridgeBase(
      o.baseQuantity,
      dimensionOf(o.unit),
      product.dimension,
      product.avgEachGrams,
    );
    if (!b) return [];
    const eff = effectivePrice(o, st, s);
    // A multi-buy price needs ≥ minQty packages; unit price shown is what one package costs per unit.
    const each = eff.minQty > 1 ? o.regularPriceCents : eff.priceCents;
    return [
      {
        storeId: o.storeId,
        storeItemId: o.storeItemId,
        title: o.title,
        brand: o.brand,
        isStoreBrand: o.isStoreBrand,
        priceCents: eff.priceCents,
        regularPriceCents: o.regularPriceCents,
        perWeight: o.basis === 'per_weight',
        sizeLabel: sizeLabel(o),
        unitPriceCents: round4(unitPriceCents(each, b.baseQuantity, product.displayUnit)),
        onSale: eff.onSale,
        memberPrice: eff.memberPrice,
        promoLabel: eff.promoLabel,
        approximate: b.approximate,
        cheapest: false,
      },
    ];
  });
  priced.sort(
    (a, b) =>
      a.unitPriceCents - b.unitPriceCents ||
      a.storeId - b.storeId ||
      a.title.localeCompare(b.title),
  );
  const min = priced[0]?.unitPriceCents;
  return {
    product,
    asOf: opts.asOf,
    stores: storeRows.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      brandColor: s.brandColor,
      requiresMembership: s.requiresMembership,
      loyaltyProgram: s.loyaltyProgram,
    })),
    offers: priced.map((o) => ({ ...o, cheapest: o.unitPriceCents === min })),
  };
}
