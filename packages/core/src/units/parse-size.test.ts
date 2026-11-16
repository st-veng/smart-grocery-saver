import { describe, expect, it } from 'vitest';
import { parseSize, type ParseSizeOptions } from './parse-size.js';
import type { UnitCode } from './table.js';

type Expected = [packCount: number, unitQuantity: number, unit: UnitCode, perWeight?: boolean];
type Fixture = [input: string, expected: Expected | null, options?: ParseSizeOptions];

const VOL: ParseSizeOptions = { dimensionHint: 'volume' };
const MASS: ParseSizeOptions = { dimensionHint: 'mass' };

const FIXTURES: Fixture[] = [
  // ── single measures: volume
  ['1 gal', [1, 1, 'gal']],
  ['1 Gallon', [1, 1, 'gal']],
  ['0.5 gal', [1, 0.5, 'gal']],
  ['1/2 gal', [1, 0.5, 'gal']],
  ['Half Gallon', [1, 0.5, 'gal']],
  ['64 fl oz', [1, 64, 'fl_oz']],
  ['64 FL. OZ.', [1, 64, 'fl_oz']],
  ['52 floz', [1, 52, 'fl_oz']],
  ['128 fluid ounces', [1, 128, 'fl_oz']],
  ['750 mL', [1, 750, 'ml']],
  ['750ml', [1, 750, 'ml']],
  ['2 L', [1, 2, 'l']],
  ['2 liter', [1, 2, 'l']],
  ['1.75 Liters', [1, 1.75, 'l']],
  ['1 qt', [1, 1, 'qt']],
  ['32 oz', [1, 32, 'fl_oz'], VOL],
  ['1 pint', [1, 1, 'pt']],
  ['1 pt.', [1, 1, 'pt']],
  // ── single measures: mass
  ['16 oz', [1, 16, 'oz']],
  ['16oz', [1, 16, 'oz'], MASS],
  ['1.5 lb', [1, 1.5, 'lb']],
  ['1.5 lbs', [1, 1.5, 'lb']],
  ['3 lb bag', [1, 3, 'lb']],
  ['5 Pounds', [1, 5, 'lb']],
  ['1 1/2 lb', [1, 1.5, 'lb']],
  ['3/4 lb', [1, 0.75, 'lb']],
  ['1/4 lb', [1, 0.25, 'lb']],
  ['454 g', [1, 454, 'g']],
  ['454g', [1, 454, 'g']],
  ['1 kg', [1, 1, 'kg']],
  ['2.5 kilograms', [1, 2.5, 'kg']],
  ['Family Size 19.3 oz', [1, 19.3, 'oz']],
  ['Family Size 19.3 oz (547 g)', [1, 19.3, 'oz']],
  ['approx. 2.25 lb', [1, 2.25, 'lb']],
  ['Approx 2.25 LB', [1, 2.25, 'lb']],
  ['.75 lb', [1, 0.75, 'lb']],
  ['10#', [1, 10, 'lb']],
  // ── counts
  ['18 ct', [1, 18, 'ea']],
  ['18 count', [1, 18, 'ea']],
  ['12 Count', [1, 12, 'ea']],
  ['dozen', [1, 1, 'dozen']],
  ['1 dozen', [1, 1, 'dozen']],
  ['a dozen', [1, 1, 'dozen']],
  ['2 dozen', [1, 2, 'dozen']],
  ['5 doz', [1, 5, 'dozen']],
  ['each', [1, 1, 'ea']],
  ['1 each', [1, 1, 'ea']],
  ['3 ea', [1, 3, 'ea']],
  ['8 rolls', [1, 8, 'ea']],
  ['10 tortillas', [1, 10, 'ea']],
  ['6 bagels', [1, 6, 'ea']],
  // ── multi-packs
  ['12 x 12 fl oz', [12, 12, 'fl_oz']],
  ['12 × 12 fl oz', [12, 12, 'fl_oz']],
  ['12x12 fl oz', [12, 12, 'fl_oz']],
  ['24 × 16.9 fl oz', [24, 16.9, 'fl_oz']],
  ['2 x 1 gal', [2, 1, 'gal']],
  ['Twin Pack 2 x 64 fl oz', [2, 64, 'fl_oz']],
  ['2/16 oz', [2, 16, 'oz']],
  ['2/16 oz', [2, 16, 'fl_oz'], VOL],
  ['6 pk / 16.9 fl oz', [6, 16.9, 'fl_oz']],
  ['6 pk 16.9 oz', [6, 16.9, 'fl_oz'], VOL],
  ['6-pack 12 oz', [6, 12, 'fl_oz'], VOL],
  ['12-pack 12 fl oz cans', [12, 12, 'fl_oz']],
  ['12 pack of 12 fl oz', [12, 12, 'fl_oz']],
  ['4 ct 15 oz', [4, 15, 'oz']],
  ['8 cans 15.25 oz', [8, 15.25, 'oz']],
  ['16.9 fl oz 24 pk', [24, 16.9, 'fl_oz']],
  ['12 fl oz, 12 pack', [12, 12, 'fl_oz']],
  ['3 x 2 lb', [3, 2, 'lb']],
  ['10 x 1.5 oz', [10, 1.5, 'oz']],
  ['6 x 32 oz', [6, 32, 'oz']],
  ['Six Pack 12 fl oz', [6, 12, 'fl_oz']],
  // ── trademark / punctuation noise
  ['Kroger® Whole Milk - 1 gal', [1, 1, 'gal']],
  ['Good & Gather™ Large Eggs - 12ct', [1, 12, 'ea']],
  // ── per-weight
  ['per lb', [1, 1, 'lb', true]],
  ['$/lb', [1, 1, 'lb', true]],
  ['Price per pound', [1, 1, 'lb', true]],
  ['sold by the lb', [1, 1, 'lb', true]],
  ['avg. 1.2 lb, price per lb', [1, 1, 'lb', true]],
  ['/kg', [1, 1, 'kg', true]],
  // ── unparseable → null (review queue, never guess)
  ['', null],
  ['assorted', null],
  ['varies', null],
  ['1 bunch', null],
  ['family size', null],
  ['0 oz', null],
];

describe('parseSize', () => {
  it('has at least 60 fixtures (SPEC §2.1)', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(60);
  });

  it.each(FIXTURES.map((f, i) => [i, ...f] as const))('#%i %j', (_i, input, expected, options) => {
    const parsed = parseSize(input, options);
    if (expected === null) {
      expect(parsed).toBeNull();
      return;
    }
    const [packCount, unitQuantity, unit, perWeight = false] = expected;
    expect(parsed).toEqual({ packCount, unitQuantity, unit, perWeight });
  });

  it('never reads explicit "fl oz" as mass, even with a mass hint', () => {
    expect(parseSize('16 fl oz', MASS)?.unit).toBe('fl_oz');
  });

  it('reads bare oz as mass unless the product is a volume', () => {
    expect(parseSize('16 oz')?.unit).toBe('oz');
    expect(parseSize('16 oz', { dimensionHint: 'count' })?.unit).toBe('oz');
    expect(parseSize('16 oz', VOL)?.unit).toBe('fl_oz');
  });
});
