import { packageBaseQuantity, parseSize, UNITS } from '@sgs/core';
import { describe, expect, it } from 'vitest';
import { FAMILY_WEEK } from './catalog/family-fixture.js';
import { PRODUCTS } from './catalog/products.js';
import { CHAINS, MAINSTREAM } from './catalog/stores.js';
import { applyObservation, observationsToPeriods, rangeLiteral } from './ingest/periods.js';
import { matchText, normalizeItem } from './ingest/normalize.js';
import {
  buildAssortment,
  chainsForProduct,
  formatSize,
  isStaple,
  parseSpecSize,
  productDimension,
} from './mock/assortment.js';
import { MockPriceProvider } from './mock/mock-provider.js';
import { roundEnding9 } from './mock/price-model.js';
import type { ProviderPrice } from './provider.js';

const SEED = '20261116';
const ANCHOR = '2026-11-01';

describe('catalog', () => {
  it('has ≥150 products with unique slugs and aliases', () => {
    expect(PRODUCTS.length).toBeGreaterThanOrEqual(150);
    expect(new Set(PRODUCTS.map((p) => p.slug)).size).toBe(PRODUCTS.length);
    const aliases = PRODUCTS.flatMap((p) => p.aliases ?? []).map((a) => a.toLowerCase());
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it('every size string parses, and matches the product dimension (or is bridgeable)', () => {
    for (const spec of PRODUCTS) {
      const dim = productDimension(spec);
      for (const size of [...spec.sizes, ...(spec.bulk ? [spec.bulk] : [])]) {
        const parsed = parseSpecSize(spec, size);
        const d = UNITS[parsed.unit].dimension;
        const ok = d === dim || (spec.avgEach !== undefined && d !== 'volume' && dim !== 'volume');
        expect(ok, `${spec.slug}: "${size}" is ${d}, product is ${dim}`).toBe(true);
      }
    }
  });

  it('every product is carried by ≥4 chains; staples by every mainstream chain', () => {
    for (const spec of PRODUCTS) {
      const chains = chainsForProduct(SEED, spec);
      expect(chains.length, spec.slug).toBeGreaterThanOrEqual(4);
      if (isStaple(spec))
        for (const m of MAINSTREAM) expect(chains, `${spec.slug}@${m}`).toContain(m);
    }
  });

  it('family fixture has 35 lines of known products', () => {
    expect(FAMILY_WEEK).toHaveLength(35);
    const slugs = new Set(PRODUCTS.map((p) => p.slug));
    for (const line of FAMILY_WEEK) expect(slugs.has(line.product), line.product).toBe(true);
  });

  it('has exactly 10 chains with the decided membership/loyalty setup', () => {
    expect(CHAINS.map((c) => c.slug)).toHaveLength(10);
    expect(CHAINS.filter((c) => c.requiresMembership).map((c) => c.slug)).toEqual([
      'costco',
      'sams',
    ]);
    expect(
      CHAINS.filter((c) => c.loyaltyProgram)
        .map((c) => c.slug)
        .sort(),
    ).toEqual(['kroger', 'tomthumb']);
    expect(CHAINS.find((c) => c.slug === 'traderjoes')?.promo).toBeNull();
  });
});

describe('assortment titles and sizes', () => {
  const items = buildAssortment(SEED);

  it('is deterministic', () => {
    expect(buildAssortment(SEED)).toEqual(items);
    expect(buildAssortment('other-seed')).not.toEqual(items);
  });

  it('formatted size text parses back to the true package (all 4 title styles)', () => {
    for (const it of items) {
      if (!it.truthSize || !it.product) continue;
      const dim = productDimension(it.product);
      const parsed = parseSize(it.sizeText, { dimensionHint: dim });
      expect(parsed, `${it.chain} ${it.sizeText}`).not.toBeNull();
      if (!parsed) continue;
      expect(parsed.perWeight).toBe(it.truthSize.perWeight);
      const base = (s: typeof parsed) => packageBaseQuantity(s.packCount, s.unitQuantity, s.unit);
      expect(base(parsed)).toBeCloseTo(base(it.truthSize), 6);
    }
  });

  it('formats multi-packs per style', () => {
    const s = { packCount: 12, unitQuantity: 12, unit: 'fl_oz' as const, perWeight: false };
    expect(formatSize(s, 0)).toBe('12 x 12 fl oz');
    expect(formatSize(s, 1)).toBe('12 pk / 12 Fluid Ounces');
    expect(formatSize(s, 2)).toBe('12 × 12 FL OZ');
    expect(formatSize(s, 3)).toBe('12 fl. oz., 12 pack');
  });

  it("Trader Joe's sells only store brand; clubs sell only bulk packs or by weight", () => {
    for (const it of items.filter((i) => i.chain === 'traderjoes' && i.product)) {
      expect(it.isStoreBrand || it.brand === null).toBe(true);
    }
    for (const it of items.filter(
      (i) => (i.chain === 'costco' || i.chain === 'sams') && i.product,
    )) {
      const spec = it.product;
      if (!spec) continue;
      const fromBulk = spec.bulk !== undefined && it.truthSize !== null;
      expect(fromBulk || it.truthSize?.perWeight, `${it.chain} ${it.title}`).toBeTruthy();
    }
  });
});

describe('normalize', () => {
  it('strips brand, size and trademark noise for fuzzy matching', () => {
    expect(matchText('Kroger® Whole Milk - 1 Gallon', 'Kroger', '1 Gallon')).toBe('whole milk');
    expect(
      matchText('2% Reduced Fat Milk - 1/2 GAL - Good & Gather™', 'Good & Gather', '1/2 GAL'),
    ).toBe('2% reduced fat milk');
    expect(matchText('80/20 Ground Beef - $/lb', null, '$/lb')).toBe('80/20 ground beef');
  });

  it('reports both dimensions for a bare "oz" until the product is known', () => {
    const n = normalizeItem({
      sku: 'x',
      upc: null,
      title: 'Cola 16 oz',
      brand: null,
      isStoreBrand: false,
      sizeText: '16 oz',
      productHint: null,
    });
    expect(n.candidateDimensions).toEqual(['mass', 'volume']);
    const v = normalizeItem({
      sku: 'y',
      upc: null,
      title: 'Cola',
      brand: null,
      isStoreBrand: false,
      sizeText: '2 L',
      productHint: null,
    });
    expect(v.candidateDimensions).toEqual(['volume']);
  });
});

describe('price model', () => {
  const provider = new MockPriceProvider({ seed: SEED, anchorDate: ANCHOR });

  it('rounds to …9 endings', () => {
    expect(roundEnding9(392)).toBe(389);
    expect(roundEnding9(395)).toBe(399);
    expect(roundEnding9(3)).toBe(9);
  });

  it('is deterministic and every sale is below regular with a consistent promo shape', async () => {
    const again = new MockPriceProvider({ seed: SEED, anchorDate: ANCHOR });
    for (const chain of CHAINS) {
      const a = await provider.getPrices({ store: chain.slug, metro: 'DFW', asOf: ANCHOR });
      const b = await again.getPrices({ store: chain.slug, metro: 'DFW', asOf: ANCHOR });
      expect(a).toEqual(b);
      for (const p of a) {
        expect(p.regularPriceCents).toBeGreaterThan(0);
        if (p.salePriceCents !== null) {
          expect(p.salePriceCents).toBeLessThan(p.regularPriceCents);
          expect(p.promoType).not.toBe('none');
        } else expect(p.promoType).toBe('none');
        if (p.promoType === 'multi_buy') expect(p.minQty).toBe(2);
      }
    }
  });

  it('prices are calibrated to the anchor: Kroger store brand matches the catalog reference', async () => {
    const milk = provider
      .allItems()
      .find(
        (i) =>
          i.chain === 'kroger' &&
          i.truthProduct === 'whole-milk' &&
          i.isStoreBrand &&
          i.sizeText.includes('Gallon'),
      );
    expect(milk).toBeDefined();
    if (!milk) return;
    const [p] = await provider.getPrices({
      store: 'kroger',
      metro: 'DFW',
      asOf: ANCHOR,
      skus: [milk.sku],
    });
    expect(Math.abs((p?.regularPriceCents ?? 0) - 389)).toBeLessThanOrEqual(15);
  });

  it('history is one observation per day', async () => {
    const it0 = provider.allItems().find((i) => i.chain === 'heb' && i.truthSize);
    if (!it0) throw new Error('no item');
    const h = await provider.getPriceHistory({
      store: 'heb',
      sku: it0.sku,
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(h).toHaveLength(31);
    expect(h[0]?.date).toBe('2026-10-01');
    expect(h[30]?.date).toBe('2026-10-31');
  });
});

describe('price periods', () => {
  const obs = (date: string, regular: number, sale: number | null = null): ProviderPrice => ({
    sku: 's',
    date,
    regularPriceCents: regular,
    salePriceCents: sale,
    promoType: sale === null ? 'none' : 'sale',
    promoLabel: sale === null ? null : 'Weekly ad',
    minQty: 1,
    memberOnly: false,
  });

  it('merges equal consecutive days and leaves the last period open', () => {
    const periods = observationsToPeriods(
      [
        obs('2026-01-01', 399),
        obs('2026-01-02', 399),
        obs('2026-01-03', 399, 299),
        obs('2026-01-04', 399),
      ],
      true,
    );
    expect(periods.map(rangeLiteral)).toEqual([
      '[2026-01-01,2026-01-03)',
      '[2026-01-03,2026-01-04)',
      '[2026-01-04,)',
    ]);
    expect(periods[1]?.salePriceCents).toBe(299);
  });

  it('closes the last period when not open-ended, and rejects gaps', () => {
    expect(observationsToPeriods([obs('2026-01-01', 1)], false).map(rangeLiteral)).toEqual([
      '[2026-01-01,2026-01-02)',
    ]);
    expect(() => observationsToPeriods([obs('2026-01-01', 1), obs('2026-01-03', 1)], true)).toThrow(
      RangeError,
    );
    expect(observationsToPeriods([], true)).toEqual([]);
  });

  it('applyObservation: unchanged, close-and-open, replace, stale, open', () => {
    const open = { ...obs('2026-01-01', 399), from: '2026-01-01', to: null };
    expect(applyObservation(open, obs('2026-01-05', 399)).kind).toBe('unchanged');
    expect(applyObservation(open, obs('2026-01-05', 349))).toMatchObject({
      kind: 'close-and-open',
      closeAt: '2026-01-05',
    });
    expect(applyObservation(open, obs('2026-01-01', 349)).kind).toBe('replace');
    expect(applyObservation(open, obs('2025-12-31', 349)).kind).toBe('stale');
    expect(applyObservation(null, obs('2026-01-05', 349)).kind).toBe('open');
  });
});
