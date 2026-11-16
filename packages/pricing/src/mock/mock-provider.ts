import { addDays, diffDays, type IsoDate } from '@sgs/core';
import { CHAINS, chainBySlug } from '../catalog/stores.js';
import type {
  Metro,
  Page,
  PriceProvider,
  ProviderItem,
  ProviderLocation,
  ProviderPrice,
  ProviderStore,
} from '../provider.js';
import { buildAssortment, type MockItem } from './assortment.js';
import { PriceModel } from './price-model.js';

export interface MockPriceProviderOptions {
  readonly seed: string | number;
  /** "Today" for the mock: history ends here, and regular prices are calibrated to it. */
  readonly anchorDate: IsoDate;
  readonly pageSize?: number;
}

const toProviderItem = (m: MockItem): ProviderItem => ({
  sku: m.sku,
  upc: m.upc,
  title: m.title,
  brand: m.brand,
  isStoreBrand: m.isStoreBrand,
  sizeText: m.sizeText,
  productHint: m.productHint,
});

/** Deterministic mock provider serving seeded DFW data for all 10 chains (SPEC §2.6). */
export class MockPriceProvider implements PriceProvider {
  readonly id = 'mock';
  private readonly items: readonly MockItem[];
  private readonly bySku = new Map<string, MockItem>();
  private readonly model: PriceModel;
  private readonly pageSize: number;

  constructor(readonly options: MockPriceProviderOptions) {
    const seed = String(options.seed);
    this.items = buildAssortment(seed);
    for (const it of this.items) this.bySku.set(`${it.chain}|${it.sku}`, it);
    this.model = new PriceModel({ seed, anchorDate: options.anchorDate });
    this.pageSize = options.pageSize ?? 250;
  }

  listStores(_metro: Metro): Promise<readonly ProviderStore[]> {
    return Promise.resolve(
      CHAINS.map((c) => ({
        slug: c.slug,
        name: c.name,
        brandColor: c.brandColor,
        requiresMembership: c.requiresMembership,
        membershipFeeCents: c.membershipFeeCents,
        loyaltyProgram: c.loyaltyProgram,
        sortOrder: c.sortOrder,
      })),
    );
  }

  listLocations(store: string, _metro: Metro): Promise<readonly ProviderLocation[]> {
    const chain = chainBySlug(store);
    return Promise.resolve(
      chain.locations.map((l, i) => ({
        externalRef: `${chain.slug}-${i + 1}`,
        name: `${chain.name} – ${l.city} (mock)`,
        address: `Mock location #${i + 1}`,
        city: l.city,
        zip: l.zip,
        lat: l.lat,
        lng: l.lng,
      })),
    );
  }

  listItems(store: string, cursor?: string | null): Promise<Page<ProviderItem>> {
    const all = this.items.filter((i) => i.chain === store);
    const start = cursor ? Number(cursor) : 0;
    const slice = all.slice(start, start + this.pageSize);
    const next = start + slice.length < all.length ? String(start + slice.length) : null;
    return Promise.resolve({ items: slice.map(toProviderItem), nextCursor: next });
  }

  getPrices(q: {
    store: string;
    metro: Metro;
    asOf: IsoDate;
    skus?: readonly string[];
  }): Promise<readonly ProviderPrice[]> {
    const wanted = q.skus ? new Set(q.skus) : null;
    return Promise.resolve(
      this.items
        .filter(
          (i) => i.chain === q.store && (!wanted || wanted.has(i.sku)) && i.truthSize !== null,
        )
        .map((i) => this.model.observe(i, q.asOf)),
    );
  }

  getPriceHistory(q: {
    store: string;
    sku: string;
    from: IsoDate;
    to: IsoDate;
  }): Promise<readonly ProviderPrice[]> {
    const item = this.bySku.get(`${q.store}|${q.sku}`);
    if (!item || item.truthSize === null) return Promise.resolve([]);
    const days = diffDays(q.to, q.from);
    const out: ProviderPrice[] = [];
    for (let d = 0; d <= days; d++) out.push(this.model.observe(item, addDays(q.from, d)));
    return Promise.resolve(out);
  }

  health(): Promise<{ ok: boolean; detail?: string }> {
    return Promise.resolve({
      ok: true,
      detail: `mock: ${this.items.length} items, anchor ${this.options.anchorDate}`,
    });
  }

  /** Test-only ground truth. Not part of PriceProvider. */
  truth(store: string, sku: string): MockItem | undefined {
    return this.bySku.get(`${store}|${sku}`);
  }

  allItems(): readonly MockItem[] {
    return this.items;
  }
}
