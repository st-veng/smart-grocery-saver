import { z } from 'zod';
import { ProductSummary, UnitCode } from './lists.js';

export const CompareStoreInfo = z.object({
  id: z.number().int(),
  slug: z.string(),
  name: z.string(),
  brandColor: z.string(),
  requiresMembership: z.boolean(),
  loyaltyProgram: z.string().nullable(),
});

export const LineAtStore = z.object({
  storeId: z.number().int(),
  status: z.enum(['ok', 'missing']),
  storeItemId: z.uuid().nullable(),
  title: z.string().nullable(),
  brand: z.string().nullable(),
  packages: z.number().int().nullable(),
  lineCents: z.number().int().nullable(),
  unitPriceCents: z.number().nullable(),
  onSale: z.boolean(),
  memberPrice: z.boolean(),
  promoLabel: z.string().nullable(),
  usedMultiBuy: z.boolean(),
  approximate: z.boolean(),
  /** Extra bought beyond the need, in the product's display unit (e.g. 1 gal). */
  overbuy: z.number(),
});
export type LineAtStore = z.infer<typeof LineAtStore>;

export const CompareLineResult = z.object({
  itemId: z.uuid(),
  rawText: z.string(),
  product: ProductSummary.nullable(),
  quantity: z.number(),
  unit: UnitCode.nullable(),
  checked: z.boolean(),
  unpriced: z.boolean(),
  /** Requested amount in the product's display unit. */
  need: z.number().nullable(),
  stores: z.array(LineAtStore),
  cheapestStoreIds: z.array(z.number().int()),
});
export type CompareLineResult = z.infer<typeof CompareLineResult>;

export const StoreTotal = z.object({
  storeId: z.number().int(),
  totalCents: z.number().int(),
  pricedCount: z.number().int(),
  missingCount: z.number().int(),
  complete: z.boolean(),
  savingsCents: z.number().int().nullable(),
  savingsPct: z.number().nullable(),
});
export type StoreTotal = z.infer<typeof StoreTotal>;

export const ComparisonResponse = z.object({
  listId: z.uuid(),
  listName: z.string(),
  asOf: z.string(),
  stores: z.array(CompareStoreInfo),
  /** Eligible stores the user can toggle (included or not), in display order. */
  available: z.array(z.object({ storeId: z.number().int(), included: z.boolean() })),
  excluded: z.array(
    z.object({
      storeId: z.number().int(),
      reason: z.enum(['disabled', 'no_membership', 'not_selected']),
    }),
  ),
  totals: z.array(StoreTotal),
  lines: z.array(CompareLineResult),
  cheapestStoreId: z.number().int().nullable(),
  cheapestWithMissingStoreId: z.number().int().nullable(),
  baseline: z.object({
    storeId: z.number().int().nullable(),
    source: z.enum(['user', 'median', 'none']),
    totalCents: z.number().int().nullable(),
  }),
  savingsPct: z.number().nullable(),
  savingsCents: z.number().int().nullable(),
  unpricedCount: z.number().int(),
});
export type ComparisonResponse = z.infer<typeof ComparisonResponse>;

export const ProductOffer = z.object({
  storeId: z.number().int(),
  storeItemId: z.uuid(),
  title: z.string(),
  brand: z.string().nullable(),
  isStoreBrand: z.boolean(),
  /** Price per package (or per pricing unit for per-weight items) this user pays. */
  priceCents: z.number().int(),
  regularPriceCents: z.number().int(),
  perWeight: z.boolean(),
  sizeLabel: z.string(),
  unitPriceCents: z.number(),
  onSale: z.boolean(),
  memberPrice: z.boolean(),
  promoLabel: z.string().nullable(),
  approximate: z.boolean(),
  cheapest: z.boolean(),
});
export type ProductOffer = z.infer<typeof ProductOffer>;

export const ProductOffersResponse = z.object({
  product: ProductSummary,
  asOf: z.string(),
  stores: z.array(CompareStoreInfo),
  offers: z.array(ProductOffer),
});
export type ProductOffersResponse = z.infer<typeof ProductOffersResponse>;
