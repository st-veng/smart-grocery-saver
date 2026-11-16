/**
 * Builds the mock assortment: which chain carries which product, in which packages and brands,
 * with what raw titles / size strings. Deterministic in (seed).
 */
import {
  hash32,
  packageBaseQuantity,
  parseSize,
  pick,
  rand01,
  type Dimension,
  type ParsedSize,
  type UnitCode,
} from '@sgs/core';
import { FAMILY_WEEK } from '../catalog/family-fixture.js';
import { PRODUCTS, type ProductSpec } from '../catalog/products.js';
import {
  CHAINS,
  MAINSTREAM,
  TOP_UP_ORDER,
  type ChainSpec,
  type StoreSlug,
} from '../catalog/stores.js';

export const NATIONAL_BRAND_PREMIUM = 1.25;
const FIXTURE_SLUGS = new Set(FAMILY_WEEK.map((l) => l.product));

export interface MockItem {
  readonly chain: StoreSlug;
  readonly sku: string;
  readonly upc: string | null;
  readonly title: string;
  readonly brand: string | null;
  readonly isStoreBrand: boolean;
  readonly sizeText: string;
  readonly productHint: string | null;
  /** Ground truth (for tests): the product this item really is, or null for unmatchable extras. */
  readonly truthProduct: string | null;
  readonly truthSize: ParsedSize | null;
  readonly product: ProductSpec | null;
}

export function productDimension(spec: ProductSpec): Dimension {
  if (spec.dim) return spec.dim;
  if (spec.byWeight) return 'mass';
  const first = spec.sizes[0];
  const parsed = first ? parseSize(first) : null;
  if (!parsed)
    throw new Error(`Product ${spec.slug}: unparseable reference size ${first ?? '(none)'}`);
  return (
    (
      { g: 'mass', kg: 'mass', oz: 'mass', lb: 'mass', ea: 'count', dozen: 'count' } as Partial<
        Record<UnitCode, Dimension>
      >
    )[parsed.unit] ?? 'volume'
  );
}

export function parseSpecSize(spec: ProductSpec, size: string): ParsedSize {
  const parsed = parseSize(size, { dimensionHint: productDimension(spec) });
  if (!parsed) throw new Error(`Product ${spec.slug}: unparseable size "${size}"`);
  return parsed;
}

/** Base quantity of the product's reference package (per lb for byWeight). */
export function referenceBase(spec: ProductSpec): number {
  const ref = parseSpecSize(spec, spec.sizes[0] ?? '');
  return ref.perWeight
    ? packageBaseQuantity(1, 1, ref.unit)
    : packageBaseQuantity(ref.packCount, ref.unitQuantity, ref.unit);
}

export function isStaple(spec: ProductSpec): boolean {
  return Boolean(spec.staple) || FIXTURE_SLUGS.has(spec.slug);
}

// ───────────── size / title formatting (exercises the size parser) ─────────────
const UNIT_WORDS: Record<UnitCode, readonly [string, string, string, string]> = {
  g: ['g', 'g', 'G', 'g'],
  kg: ['kg', 'kg', 'KG', 'kg'],
  oz: ['oz', 'Ounce', 'OZ', 'oz'],
  lb: ['lb', 'Pound', 'LB', 'lbs'],
  ml: ['ml', 'mL', 'ML', 'ml'],
  l: ['L', 'Liter', 'L', 'l'],
  fl_oz: ['fl oz', 'Fluid Ounces', 'FL OZ', 'fl. oz.'],
  pt: ['pt', 'Pint', 'PT', 'pt'],
  qt: ['qt', 'Quart', 'QT', 'qt'],
  gal: ['gal', 'Gallon', 'GAL', 'gal'],
  ea: ['ct', 'Count', 'CT', 'count'],
  dozen: ['dozen', 'Dozen', 'DOZEN', 'dozen'],
};

function fmtQty(q: number, style: number): string {
  if (style === 2 && q === 0.5) return '1/2';
  return String(q);
}

export function formatSize(size: ParsedSize, style: 0 | 1 | 2 | 3, countWord?: string): string {
  if (size.perWeight)
    return ['per lb', '$/lb', 'Price per pound', 'sold by the lb'][style] ?? 'per lb';
  const u = size.unit === 'ea' && countWord ? countWord : UNIT_WORDS[size.unit][style];
  const one = `${fmtQty(size.unitQuantity, style)} ${u}`;
  if (size.packCount === 1) return one;
  switch (style) {
    case 0:
      return `${size.packCount} x ${one}`;
    case 1:
      return size.unit === 'ea' ? `${size.packCount} x ${one}` : `${size.packCount} pk / ${one}`;
    case 2:
      return `${size.packCount} × ${one}`;
    default:
      return size.unit === 'ea' ? `${size.packCount} x ${one}` : `${one}, ${size.packCount} pack`;
  }
}

function countWordFor(size: string): string | undefined {
  const m = /\b(rolls)\b/.exec(size);
  return m?.[1];
}

function title(chain: ChainSpec, brand: string | null, name: string, sizeText: string): string {
  const b = brand ?? '';
  switch (chain.titleStyle) {
    case 0:
      return `${b} ${name}, ${sizeText}`.trim();
    case 1:
      return brand ? `${b}® ${name} - ${sizeText}` : `${name} - ${sizeText}`;
    case 2:
      return brand ? `${name} - ${sizeText} - ${b}™` : `${name} - ${sizeText}`;
    default:
      return `${b} ${name} ${sizeText}`.trim();
  }
}

function upcFor(...parts: readonly (string | number)[]): string {
  const a = hash32(parts.join('|')).toString().padStart(10, '0').slice(0, 6);
  const b = hash32(`${parts.join('|')}|b`)
    .toString()
    .padStart(10, '0')
    .slice(0, 6);
  return `0${a}${b}`.slice(0, 12);
}

// ───────────── coverage ─────────────
export function chainsForProduct(seed: string, spec: ProductSpec): StoreSlug[] {
  const carried = new Set<StoreSlug>();
  for (const chain of CHAINS) {
    if (chain.bulkOnly && !spec.bulk && !spec.byWeight) continue;
    if (chain.storeBrandOnly && spec.category === 'household') continue;
    const roll = rand01(seed, 'cover', chain.slug, spec.slug);
    if (roll < chain.coverage(spec.category)) carried.add(chain.slug);
  }
  if (isStaple(spec)) for (const s of MAINSTREAM) carried.add(s);
  for (const s of TOP_UP_ORDER) {
    if (carried.size >= 4) break;
    carried.add(s);
  }
  return CHAINS.map((c) => c.slug).filter((s) => carried.has(s));
}

/** Unmatchable seasonal one-offs (go to the review queue) and one unparseable size per chain. */
const EXTRAS: readonly { title: string; size: string }[] = [
  { title: 'Seasonal Finds Pumpkin Spice Pretzel Bites', size: '8 oz' },
  { title: 'Holiday Gingerbread House Kit', size: '28 oz' },
  { title: 'Assorted Floral Bouquet', size: 'varies' },
];

export function buildAssortment(seed: string): MockItem[] {
  const items: MockItem[] = [];
  for (const spec of PRODUCTS) {
    const chains = chainsForProduct(seed, spec);
    for (const slug of chains) {
      const chain = CHAINS.find((c) => c.slug === slug);
      if (!chain) continue;
      items.push(...itemsFor(seed, chain, spec));
    }
  }
  for (const chain of CHAINS) {
    EXTRAS.forEach((extra, i) => {
      const brand = chain.storeBrands[0] ?? null;
      const sizeText = extra.size;
      items.push({
        chain: chain.slug,
        sku: `${chain.slug.slice(0, 3).toUpperCase()}-X${i + 1}`,
        upc: null,
        title: title(chain, brand, extra.title, sizeText),
        brand,
        isStoreBrand: true,
        sizeText,
        productHint: null,
        truthProduct: null,
        truthSize: parseSize(sizeText),
        product: null,
      });
    });
  }
  return items;
}

function itemsFor(seed: string, chain: ChainSpec, spec: ProductSpec): MockItem[] {
  const out: MockItem[] = [];
  const skuBase = `${chain.slug.slice(0, 3).toUpperCase()}-${hash32(`${chain.slug}|${spec.slug}`).toString(36).toUpperCase()}`;
  const fresh = spec.byWeight || spec.category === 'produce';
  const storeBrand = pick(chain.storeBrands, seed, 'sb', chain.slug, spec.slug);

  const add = (size: string, brand: string | null, isStoreBrand: boolean, n: number) => {
    const parsed = parseSpecSize(spec, size);
    const sizeText = formatSize(parsed, chain.titleStyle, countWordFor(size));
    const sku = `${skuBase}-${n}`;
    const national = !isStoreBrand && brand !== null;
    const hint = rand01(seed, 'hint', chain.slug, sku) < 0.85 ? spec.slug : null;
    out.push({
      chain: chain.slug,
      sku,
      upc: national
        ? upcFor('nat', brand, spec.slug, size)
        : fresh
          ? null
          : upcFor('sb', chain.slug, sku),
      title: title(chain, brand, spec.name, sizeText),
      brand,
      isStoreBrand,
      sizeText,
      productHint: hint,
      truthProduct: spec.slug,
      truthSize: parsed,
      product: spec,
    });
  };

  if (chain.bulkOnly) {
    if (spec.bulk) {
      const brands = spec.brands ?? [];
      const national =
        brands.length > 0 && rand01(seed, 'clubnat', chain.slug, spec.slug) < chain.nationalShare;
      if (national) add(spec.bulk, pick(brands, seed, 'nb', chain.slug, spec.slug), false, 1);
      else add(spec.bulk, fresh ? null : storeBrand, !fresh, 1);
    } else if (spec.byWeight) {
      add('per lb', null, false, 1);
    }
    return out;
  }

  const mainSize = spec.sizes[0] ?? 'per lb';
  if (fresh) {
    add(mainSize, null, false, 1);
    return out;
  }
  // Store-brand item in the reference size (Aldi/TJ: almost always store brand).
  add(mainSize, storeBrand, true, 1);
  const second = spec.sizes[1];
  if (second && rand01(seed, 'size2', chain.slug, spec.slug) < chain.secondSizeShare) {
    add(second, storeBrand, true, 2);
  }
  if (
    !chain.storeBrandOnly &&
    spec.brands?.length &&
    rand01(seed, 'nat', chain.slug, spec.slug) < chain.nationalShare
  ) {
    const size = second && rand01(seed, 'natsize', chain.slug, spec.slug) < 0.3 ? second : mainSize;
    add(size, pick(spec.brands, seed, 'nb', chain.slug, spec.slug), false, 3);
  }
  return out;
}
