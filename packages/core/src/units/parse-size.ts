import type { Dimension, UnitCode } from './table.js';

export interface ParsedSize {
  readonly packCount: number;
  readonly unitQuantity: number;
  readonly unit: UnitCode;
  /** True for loose items priced per weight ("per lb", "/lb"). Quantity is then 1 unit. */
  readonly perWeight: boolean;
}

export interface ParseSizeOptions {
  /**
   * The dimension of the product this size belongs to, if known. A bare "oz" is read as
   * fl_oz only when the hint is 'volume'. Never coerces explicit "fl oz" to mass.
   */
  readonly dimensionHint?: Dimension;
}

const UNIT_ALIASES: ReadonlyArray<readonly [RegExp, UnitCode | 'oz?']> = [
  [/^(?:fl\.?\s*oz\.?|floz|fluid\s+ounces?)$/, 'fl_oz'],
  [/^(?:oz\.?|ounces?)$/, 'oz?'],
  [/^(?:lbs?\.?|pounds?|#)$/, 'lb'],
  [/^(?:kg|kgs|kilograms?|kilos?)$/, 'kg'],
  [/^(?:g|gr|grams?)$/, 'g'],
  [/^(?:ml|milliliters?|millilitres?)$/, 'ml'],
  [/^(?:l|ltr|liters?|litres?)$/, 'l'],
  [/^(?:gal\.?|gallons?)$/, 'gal'],
  [/^(?:qt\.?|quarts?)$/, 'qt'],
  [/^(?:pt\.?|pints?)$/, 'pt'],
  [/^(?:dozen|doz\.?|dz)$/, 'dozen'],
  [
    /^(?:ct\.?|count|ea\.?|each|pcs?\.?|pieces?|eggs|rolls|bags|cans|bottles|bars|pouches|cups|sticks|slices|tortillas|bagels|muffins|buns)$/,
    'ea',
  ],
];

// Longest alternatives first so "fl oz" wins over "oz", "lbs" over "lb", etc.
const UNIT_RE =
  'fl\\.?\\s*oz\\.?|floz|fluid\\s+ounces?|ounces?|oz\\.?|pounds?|lbs?\\.?|kilograms?|kilos?|kgs?|grams?|gr|g|milliliters?|millilitres?|ml|liters?|litres?|ltr|l|gallons?|gal\\.?|quarts?|qt\\.?|pints?|pt\\.?|dozen|doz\\.?|dz|count|ct\\.?|each|ea\\.?|pieces?|pcs?\\.?|eggs|rolls|bags|cans|bottles|bars|pouches|cups|sticks|slices|tortillas|bagels|muffins|buns|#';

// A number: decimal ("16.9", ".5"), mixed fraction ("1 1/2"), or simple fraction ("1/2").
const NUM_RE = '(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d*\\.\\d+|\\d+)';
const PACK_WORD_RE = '(?:-|\\s)?(?:pk|pack|packs|ct|count|cans?|bottles?)';

const WORD_NUMBERS: Readonly<Record<string, string>> = {
  half: '0.5',
  one: '1',
  two: '2',
  twin: '2',
  three: '3',
  four: '4',
  six: '6',
  eight: '8',
  twelve: '12',
};

function parseNumber(text: string): number {
  const t = text.trim();
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(t);
}

function resolveUnit(token: string, hint: Dimension | undefined): UnitCode | null {
  const t = token.trim().toLowerCase();
  for (const [re, code] of UNIT_ALIASES) {
    if (re.test(t)) {
      if (code === 'oz?') return hint === 'volume' ? 'fl_oz' : 'oz';
      return code;
    }
  }
  return null;
}

function normalize(input: string): string {
  let s = input.replace(/[®™©]/g, ' ').toLowerCase().normalize('NFKC');
  s = s.replace(/[×✕]/g, 'x').replace(/,/g, ' ');
  s = s.replace(/\(([^)]*)\)/g, ' ( $1 ) ');
  // "half gallon" / "twin pack" style words
  s = s.replace(/\b(half)[\s-]+(gallon|gal)\b/g, '0.5 gallon');
  s = s.replace(/\b(twin|two)[\s-]+pack\b/g, '2 pack');
  s = s.replace(
    /\b(six|twelve|eight|four|three)[\s-]+pack\b/g,
    (_m, w: string) => `${WORD_NUMBERS[w] ?? w} pack`,
  );
  s = s.replace(/\ba\s+dozen\b/g, '1 dozen');
  // "12-pack" → "12 pack", "16oz" → "16 oz"
  s = s.replace(/(\d)-(pk|pack|ct|count)\b/g, '$1 $2');
  s = s.replace(/(\d)([a-z#])/g, '$1 $2');
  return s.replace(/\s+/g, ' ').trim();
}

function result(
  packCount: number,
  unitQuantity: number,
  unit: UnitCode,
  perWeight = false,
): ParsedSize | null {
  if (!Number.isFinite(unitQuantity) || unitQuantity <= 0) return null;
  if (!Number.isInteger(packCount) || packCount < 1 || packCount > 500) return null;
  return { packCount, unitQuantity: Math.round(unitQuantity * 10_000) / 10_000, unit, perWeight };
}

/** Is "a/b" a fraction of a unit (1/2 gal) rather than a multipack (2/16 oz)? */
function isFraction(a: number, b: number): boolean {
  return a < b && [2, 3, 4, 8].includes(b);
}

/**
 * Parse a retail size string into pack count, per-unit quantity and unit.
 * Returns null when the size cannot be determined unambiguously (callers must route
 * such items to the review queue — never guess).
 *
 * Examples: "1 gal", "12 x 12 fl oz", "2/16 oz", "6 pk 16.9 oz", "1.5 lb", "dozen",
 * "18 ct", "750 mL", "Family Size 19.3 oz (547 g)", "approx. 2.25 lb", "per lb".
 */
export function parseSize(input: string, options: ParseSizeOptions = {}): ParsedSize | null {
  const hint = options.dimensionHint;
  const s = normalize(input);
  if (s.length === 0) return null;

  // Priced per weight: "per lb", "/lb", "$/lb", "price per pound", "sold by the lb"
  const perWeight = /(?:\bper\s+|\/\s*|\bby\s+the\s+)(lb|lbs|pound|kg|oz)\b/.exec(s);
  if (perWeight?.[1]) {
    const unit = resolveUnit(perWeight[1], 'mass');
    return unit ? result(1, 1, unit, true) : null;
  }

  // Strip parenthesised secondary measures: "19.3 oz ( 547 g )" → first measure wins.
  const primary = s
    .replace(/\(\s*[^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 1) "N x Q unit" / "N/Q unit" / "N pk Q unit" / "N pk / Q unit" / "N ct Q unit"
  const multi = new RegExp(
    `(\\d+)\\s*(?:${PACK_WORD_RE})?\\s*(?:x|/|-)\\s*(${NUM_RE})\\s*(${UNIT_RE})(?![a-z])`,
  ).exec(primary);
  if (multi?.[1] && multi[2] && multi[3]) {
    const a = Number(multi[1]);
    const b = parseNumber(multi[2]);
    const unit = resolveUnit(multi[3], hint);
    // "1/2 gal" is a fraction, not a pack of 1 × 2 gal.
    const sep = new RegExp(`^(\\d+)\\s*/\\s*${NUM_RE}`).test(multi[0]);
    if (unit && !(sep && isFraction(a, b))) return result(a, b, unit);
  }
  const packThenSize = new RegExp(
    `(\\d+)${PACK_WORD_RE}\\b\\s*(?:of\\s+)?(${NUM_RE})\\s*(${UNIT_RE})(?![a-z])`,
  ).exec(primary);
  if (packThenSize?.[1] && packThenSize[2] && packThenSize[3]) {
    const unit = resolveUnit(packThenSize[3], hint);
    if (unit && unit !== 'ea')
      return result(Number(packThenSize[1]), parseNumber(packThenSize[2]), unit);
  }
  // "Q unit , N pk" / "16.9 fl oz 24 pk" / "12 fl oz cans 12 pack"
  const sizeThenPack = new RegExp(
    `(${NUM_RE})\\s*(${UNIT_RE})(?![a-z])\\s*(?:[a-z]+\\s+)?(?:-\\s*)?(\\d+)\\s*(?:pk|pack|ct|count)\\b`,
  ).exec(primary);
  if (sizeThenPack?.[1] && sizeThenPack[2] && sizeThenPack[3]) {
    const unit = resolveUnit(sizeThenPack[2], hint);
    if (unit && unit !== 'ea')
      return result(Number(sizeThenPack[3]), parseNumber(sizeThenPack[1]), unit);
  }

  // 2) Single measure: "1.5 lb", "1/2 gal", "1 1/2 lb", "18 ct", "2 dozen"
  const single = new RegExp(`(?:^|[^\\d./])(${NUM_RE})\\s*(${UNIT_RE})(?![a-z])`).exec(primary);
  if (single?.[1] && single[2]) {
    const unit = resolveUnit(single[2], hint);
    if (unit) return result(1, parseNumber(single[1]), unit);
  }

  // 3) Bare unit words: "dozen", "gallon", "each"
  const bare = new RegExp(`^(?:approx\\.?\\s+)?(${UNIT_RE})$`).exec(primary);
  if (bare?.[1]) {
    const unit = resolveUnit(bare[1], hint);
    if (unit) return result(1, 1, unit);
  }
  return null;
}
