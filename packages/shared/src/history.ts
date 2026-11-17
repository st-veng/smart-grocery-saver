import { z } from 'zod';
import { CompareStoreInfo } from './compare.js';
import { ProductSummary, UnitCode } from './lists.js';

export const HistoryRange = z.enum(['30d', '90d', '365d']);
export type HistoryRange = z.infer<typeof HistoryRange>;
export const RANGE_DAYS: Record<HistoryRange, number> = { '30d': 30, '90d': 90, '365d': 365 };

export const StepPoint = z.object({ date: z.string(), unitPriceCents: z.number().nullable() });

export const HistoryResponse = z.object({
  product: ProductSummary,
  range: HistoryRange,
  from: z.string(),
  to: z.string(),
  stores: z.array(CompareStoreInfo),
  /** One step series per store the user shops at, in the product's display unit. */
  series: z.array(z.object({ storeId: z.number().int(), points: z.array(StepPoint) })),
  /** Lowest unit price at any of the user's stores in the 365 days ending `to`. */
  historicLow: z
    .object({ unitPriceCents: z.number(), storeId: z.number().int(), date: z.string() })
    .nullable(),
  current: z.object({ unitPriceCents: z.number(), storeId: z.number().int() }).nullable(),
  /** Today's best price equals the 1-year low (badge). */
  atHistoricLow: z.boolean(),
});
export type HistoryResponse = z.infer<typeof HistoryResponse>;

export const StoreItemHistoryResponse = z.object({
  storeItemId: z.uuid(),
  title: z.string(),
  storeId: z.number().int(),
  range: HistoryRange,
  from: z.string(),
  to: z.string(),
  /** Package price periods clipped to the range: regular vs what this user pays. */
  periods: z.array(
    z.object({
      from: z.string(),
      to: z.string().nullable(),
      regularPriceCents: z.number().int(),
      priceCents: z.number().int(),
      promoLabel: z.string().nullable(),
    }),
  ),
});

export const AlertKind = z.enum(['historic_low', 'target_price']);

export const Alert = z.object({
  id: z.uuid(),
  product: ProductSummary,
  kind: AlertKind,
  /** Cents per the product's display unit. */
  targetCents: z.number().int().nullable(),
  active: z.boolean(),
  lastTriggeredAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Alert = z.infer<typeof Alert>;
export const AlertsResponse = z.object({ alerts: z.array(Alert) });
export const AlertResponse = z.object({ alert: Alert });

export const CreateAlertRequest = z
  .object({
    productId: z.uuid(),
    kind: AlertKind,
    targetCents: z.number().int().positive().max(1_000_000).optional(),
  })
  .strict()
  .refine((v) => (v.kind === 'target_price') === (v.targetCents !== undefined), {
    message: 'A target price alert needs targetCents (and only it)',
    path: ['targetCents'],
  });
export type CreateAlertRequest = z.infer<typeof CreateAlertRequest>;

export const UpdateAlertRequest = z
  .object({ active: z.boolean(), targetCents: z.number().int().positive().max(1_000_000) })
  .partial()
  .strict();

export const Notification = z.object({
  id: z.uuid(),
  kind: AlertKind,
  createdAt: z.string(),
  read: z.boolean(),
  productId: z.uuid(),
  productName: z.string(),
  storeName: z.string(),
  unitPriceCents: z.number(),
  displayUnit: UnitCode,
  priorLowCents: z.number().nullable(),
  targetCents: z.number().nullable(),
  promoLabel: z.string().nullable(),
  asOf: z.string(),
});
export type Notification = z.infer<typeof Notification>;
export const NotificationsResponse = z.object({
  notifications: z.array(Notification),
  unreadCount: z.number().int(),
});

export const SimAdvanceRequest = z
  .object({ to: z.string().optional(), days: z.number().int().min(1).max(366).optional() })
  .strict();
export const SimAdvanceResponse = z.object({
  from: z.string(),
  to: z.string(),
  applied: z.array(z.string()),
  notificationsCreated: z.number().int(),
});
