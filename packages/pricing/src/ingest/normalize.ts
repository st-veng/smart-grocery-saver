import { dimensionOf, parseSize, type Dimension, type ParsedSize } from '@sgs/core';
import type { ProviderItem } from '../provider.js';

export interface NormalizedItem {
  readonly item: ProviderItem;
  /** Lowercased title with brand, size and trademark noise removed — input to fuzzy matching. */
  readonly matchText: string;
  /** Size parsed without a product hint (bare "oz" read as mass), or null if unparseable. */
  readonly roughSize: ParsedSize | null;
  /** Dimensions the item could be: bare "oz" could be mass or volume until matched. */
  readonly candidateDimensions: readonly Dimension[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SIZE_TOKEN =
  /\b\d+(?:[./]\d+)?\s*(?:x|×|pk|pack|ct|count|fl\.?\s*oz\.?|fluid ounces?|ounces?|oz|lbs?|pounds?|gal(?:lons?)?|qt|quarts?|pt|pints?|l|liters?|ml|g|kg|rolls)\b\.?/gi;

export function matchText(title: string, brand: string | null, sizeText: string): string {
  let s = title.replace(/[®™©]/g, ' ').normalize('NFKC');
  if (brand) s = s.replace(new RegExp(escapeRe(brand), 'gi'), ' ');
  if (sizeText) s = s.replace(new RegExp(escapeRe(sizeText), 'gi'), ' ');
  s = s.replace(SIZE_TOKEN, ' ').replace(/\$\/lb|price per pound|sold by the lb|per lb/gi, ' ');
  s = s.replace(/[^\p{L}\p{N}%&/' ]+/gu, ' ').toLowerCase();
  return s.replace(/\s+/g, ' ').trim();
}

export function normalizeItem(item: ProviderItem): NormalizedItem {
  const roughSize = parseSize(item.sizeText);
  let candidateDimensions: Dimension[] = [];
  if (roughSize) {
    const d = dimensionOf(roughSize.unit);
    candidateDimensions =
      roughSize.unit === 'oz' && !roughSize.perWeight ? ['mass', 'volume'] : [d];
  }
  return {
    item,
    matchText: matchText(item.title, item.brand, item.sizeText),
    roughSize,
    candidateDimensions,
  };
}

/** Re-parse with the matched product's dimension, so a beverage "16.9 oz" becomes fl_oz. */
export function finalSize(item: ProviderItem, dimension: Dimension | null): ParsedSize | null {
  return dimension
    ? parseSize(item.sizeText, { dimensionHint: dimension })
    : parseSize(item.sizeText);
}
