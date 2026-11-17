/** Load price periods for products and convert them to per-store unit prices for one user. */
import {
  offerUnitPrice,
  type CompareStore,
  type DateRange,
  type IsoDate,
  type StoreSettings,
  type UnitCode,
  type UnitPricePeriod,
  type UnitPriceProduct,
} from '@sgs/core';
import type { Db } from '@sgs/db';
import { sql } from 'drizzle-orm';
import type { UserStoreView } from '../user-stores.js';

export interface RawPeriod extends Record<string, unknown> {
  readonly pricePointId: number;
  readonly productId: string;
  readonly storeId: number;
  readonly storeItemId: string;
  readonly title: string;
  readonly brand: string | null;
  readonly isStoreBrand: boolean;
  readonly basis: 'per_package' | 'per_weight';
  readonly baseQuantity: number;
  readonly unit: UnitCode;
  readonly regularPriceCents: number;
  readonly salePriceCents: number | null;
  readonly promoLabel: string | null;
  readonly minQty: number;
  readonly memberOnly: boolean;
  readonly from: IsoDate;
  readonly to: IsoDate | null;
}

/** Every price period of these products' active store items overlapping [from, to] (inclusive). */
export async function loadRawPeriods(
  db: Db,
  productIds: readonly string[],
  range: DateRange,
  metro: string,
): Promise<RawPeriod[]> {
  if (productIds.length === 0) return [];
  const r = await db.execute<RawPeriod>(sql`
    SELECT pp.id::int AS "pricePointId", si.product_id AS "productId", si.store_id AS "storeId", si.id AS "storeItemId",
           si.title, si.brand, si.is_store_brand AS "isStoreBrand", si.pricing_basis::text AS basis,
           (CASE WHEN si.pricing_basis = 'per_weight' THEN unit_factor(si.unit) ELSE si.base_quantity END)::float8 AS "baseQuantity",
           si.unit::text AS unit, pp.regular_price_cents AS "regularPriceCents", pp.sale_price_cents AS "salePriceCents",
           pp.promo_label AS "promoLabel", pp.min_qty AS "minQty", pp.member_only AS "memberOnly",
           lower(pp.valid_during)::text AS "from", upper(pp.valid_during)::text AS "to"
    FROM price_points pp JOIN store_items si ON si.id = pp.store_item_id
    WHERE si.active AND pp.metro = ${metro} AND pp.store_location_id IS NULL
      AND si.product_id = ANY(ARRAY[${sql.join(
        productIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[])
      AND pp.valid_during && daterange(${range.from}::date, ${range.to}::date, '[]')`);
  return r.rows;
}

export interface StorePeriods {
  readonly store: CompareStore;
  readonly periods: (UnitPricePeriod & {
    readonly storeItemId: string;
    readonly onSale: boolean;
    readonly promoLabel: string | null;
  })[];
}

/**
 * Unit-price periods per store this user can shop at (enabled; membership for clubs), using their
 * member/loyalty eligibility. Items whose units can't be compared with the product are skipped.
 */
export function unitPeriodsFor(
  rows: readonly RawPeriod[],
  productId: string,
  product: UnitPriceProduct,
  view: UserStoreView,
): Map<number, StorePeriods> {
  const out = new Map<number, StorePeriods>();
  const byId = new Map(view.stores.map((s) => [s.id, s]));
  for (const r of rows) {
    if (r.productId !== productId) continue;
    const s = byId.get(r.storeId);
    if (!s?.enabled || (s.requiresMembership && !s.hasMembership)) continue;
    const settings: StoreSettings = {
      enabled: s.enabled,
      hasMembership: s.hasMembership,
      hasLoyalty: s.hasLoyalty,
    };
    const u = offerUnitPrice(
      {
        storeItemId: r.storeItemId,
        storeId: r.storeId,
        productId: r.productId,
        title: r.title,
        brand: r.brand,
        isStoreBrand: r.isStoreBrand,
        basis: r.basis,
        baseQuantity: r.baseQuantity,
        unit: r.unit,
        regularPriceCents: r.regularPriceCents,
        salePriceCents: r.salePriceCents,
        promoLabel: r.promoLabel,
        minQty: r.minQty,
        memberOnly: r.memberOnly,
      },
      product,
      s,
      settings,
    );
    if (!u) continue;
    const entry = out.get(s.id) ?? { store: s, periods: [] };
    entry.periods.push({
      from: r.from,
      to: r.to,
      unitPriceCents: u.unitPriceCents,
      pricePointId: r.pricePointId,
      storeItemId: r.storeItemId,
      onSale: u.onSale,
      promoLabel: u.onSale ? r.promoLabel : null,
    });
    out.set(s.id, entry);
  }
  return out;
}
