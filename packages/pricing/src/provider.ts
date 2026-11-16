/** PriceProvider contract (SPEC §2.6). Providers return RAW data; normalization and matching are ours. */
import type { IsoDate } from '@sgs/core';

export type Metro = 'DFW';

export interface ProviderStore {
  readonly slug: string;
  readonly name: string;
  readonly brandColor: string;
  readonly requiresMembership: boolean;
  readonly membershipFeeCents: number | null;
  readonly loyaltyProgram: string | null;
  readonly sortOrder: number;
}

export interface ProviderLocation {
  readonly externalRef: string;
  readonly name: string;
  readonly address: string;
  readonly city: string;
  readonly zip: string;
  readonly lat: number;
  readonly lng: number;
}

export interface ProviderItem {
  readonly sku: string;
  readonly upc: string | null;
  readonly title: string;
  readonly brand: string | null;
  readonly isStoreBrand: boolean;
  /** Raw size text as the retailer shows it ("12 x 12 fl oz", "per lb", "1 Gallon"). */
  readonly sizeText: string;
  /** Optional provider-supplied product mapping (a "rule" match); real feeds may omit it. */
  readonly productHint: string | null;
}

export type PromoType = 'none' | 'sale' | 'clearance' | 'member' | 'multi_buy';

export interface ProviderPrice {
  readonly sku: string;
  readonly date: IsoDate;
  readonly regularPriceCents: number;
  readonly salePriceCents: number | null;
  readonly promoType: PromoType;
  readonly promoLabel: string | null;
  readonly minQty: number;
  readonly memberOnly: boolean;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface PriceProvider {
  readonly id: string;
  listStores(metro: Metro): Promise<readonly ProviderStore[]>;
  listLocations(store: string, metro: Metro): Promise<readonly ProviderLocation[]>;
  listItems(store: string, cursor?: string | null): Promise<Page<ProviderItem>>;
  getPrices(q: {
    store: string;
    metro: Metro;
    asOf: IsoDate;
    skus?: readonly string[];
  }): Promise<readonly ProviderPrice[]>;
  getPriceHistory?(q: {
    store: string;
    sku: string;
    from: IsoDate;
    to: IsoDate;
  }): Promise<readonly ProviderPrice[]>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}
