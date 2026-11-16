import type { ListItem, ProductSummary } from '@sgs/shared';

type Unit = NonNullable<ListItem['unit']>;

export const UNIT_LABEL: Record<Unit, string> = {
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
  ea: 'ea',
  dozen: 'dozen',
};

const BY_DIMENSION: Record<ProductSummary['dimension'], Unit[]> = {
  mass: ['lb', 'oz', 'kg', 'g'],
  volume: ['gal', 'qt', 'pt', 'fl_oz', 'l', 'ml'],
  count: ['ea', 'dozen'],
};

/** Units a list item for this product may use (count↔mass when the product has an average weight). */
export function unitsFor(p: Pick<ProductSummary, 'dimension' | 'avgEachGrams'>): Unit[] {
  const own = BY_DIMENSION[p.dimension];
  if (p.avgEachGrams !== null && p.dimension !== 'volume') {
    return [...own, ...BY_DIMENSION[p.dimension === 'mass' ? 'count' : 'mass']];
  }
  return own;
}

export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** "2 gal", "3 × 1 gal", "×2" — what the shopper needs, in words a person would write. */
export function formatQuantity(i: Pick<ListItem, 'quantity' | 'unit' | 'product'>): string {
  if (i.unit) return `${formatNumber(i.quantity)} ${UNIT_LABEL[i.unit]}`;
  if (i.product) {
    const pkg = `${formatNumber(i.product.defaultQuantity)} ${UNIT_LABEL[i.product.defaultUnit]}`;
    return i.quantity === 1 ? pkg : `${formatNumber(i.quantity)} × ${pkg}`;
  }
  return i.quantity === 1 ? '' : `×${formatNumber(i.quantity)}`;
}
