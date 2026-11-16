/**
 * Unit factor table. MUST stay identical to SQL `unit_factor()` / `unit_dim()`
 * (migration 0000). A DB parity test enforces this.
 */
export const UNIT_CODES = [
  'g',
  'kg',
  'oz',
  'lb',
  'ml',
  'l',
  'fl_oz',
  'pt',
  'qt',
  'gal',
  'ea',
  'dozen',
] as const;
export type UnitCode = (typeof UNIT_CODES)[number];

export const DIMENSIONS = ['mass', 'volume', 'count'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface UnitDef {
  readonly dimension: Dimension;
  /** Multiply a quantity in this unit by `factor` to get base units (g, ml, ea). */
  readonly factor: number;
  readonly label: string;
}

export const UNITS: Readonly<Record<UnitCode, UnitDef>> = {
  g: { dimension: 'mass', factor: 1, label: 'g' },
  kg: { dimension: 'mass', factor: 1000, label: 'kg' },
  oz: { dimension: 'mass', factor: 28.349523125, label: 'oz' },
  lb: { dimension: 'mass', factor: 453.59237, label: 'lb' },
  ml: { dimension: 'volume', factor: 1, label: 'mL' },
  l: { dimension: 'volume', factor: 1000, label: 'L' },
  fl_oz: { dimension: 'volume', factor: 29.5735295625, label: 'fl oz' },
  pt: { dimension: 'volume', factor: 473.176473, label: 'pt' },
  qt: { dimension: 'volume', factor: 946.352946, label: 'qt' },
  gal: { dimension: 'volume', factor: 3785.411784, label: 'gal' },
  ea: { dimension: 'count', factor: 1, label: 'ea' },
  dozen: { dimension: 'count', factor: 12, label: 'dozen' },
};

export const BASE_UNIT: Readonly<Record<Dimension, UnitCode>> = {
  mass: 'g',
  volume: 'ml',
  count: 'ea',
};

export function isUnitCode(value: string): value is UnitCode {
  return (UNIT_CODES as readonly string[]).includes(value);
}
