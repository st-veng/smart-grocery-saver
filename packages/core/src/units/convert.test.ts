import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bridgeBase,
  convert,
  dimensionOf,
  fromBase,
  packageBaseQuantity,
  toBase,
} from './convert.js';
import { BASE_UNIT, UNIT_CODES, UNITS, type UnitCode } from './table.js';

describe('unit table', () => {
  it('base units have factor 1', () => {
    for (const u of Object.values(BASE_UNIT)) expect(UNITS[u].factor).toBe(1);
  });

  it('uses exact US customary definitions', () => {
    expect(toBase(1, 'lb')).toBeCloseTo(453.59237, 10);
    expect(toBase(16, 'oz')).toBeCloseTo(toBase(1, 'lb'), 9);
    expect(toBase(128, 'fl_oz')).toBeCloseTo(toBase(1, 'gal'), 9);
    expect(toBase(4, 'qt')).toBeCloseTo(toBase(1, 'gal'), 9);
    expect(toBase(2, 'pt')).toBeCloseTo(toBase(1, 'qt'), 9);
    expect(toBase(1, 'dozen')).toBe(12);
  });
});

describe('convert', () => {
  it('converts within a dimension', () => {
    expect(convert(1, 'gal', 'fl_oz')).toBeCloseTo(128, 9);
    expect(convert(2, 'lb', 'oz')).toBeCloseTo(32, 9);
    expect(convert(1, 'kg', 'lb')).toBeCloseTo(2.20462262, 6);
    expect(convert(3, 'dozen', 'ea')).toBe(36);
  });

  it('refuses oz ↔ fl_oz and other cross-dimension conversions', () => {
    expect(() => convert(1, 'oz', 'fl_oz')).toThrow(RangeError);
    expect(() => convert(1, 'lb', 'ea')).toThrow(RangeError);
  });

  it('round-trips any unit pair in the same dimension', () => {
    const units = fc.constantFrom(...UNIT_CODES);
    fc.assert(
      fc.property(units, units, fc.double({ min: 0.001, max: 1e6, noNaN: true }), (a, b, q) => {
        fc.pre(dimensionOf(a) === dimensionOf(b));
        const back = convert(convert(q, a, b), b, a);
        return Math.abs(back - q) <= q * 1e-12;
      }),
    );
  });

  it('fromBase inverts toBase', () => {
    for (const u of UNIT_CODES) expect(fromBase(toBase(2.5, u), u)).toBeCloseTo(2.5, 12);
  });
});

describe('packageBaseQuantity', () => {
  it('handles multi-packs', () => {
    expect(packageBaseQuantity(12, 12, 'fl_oz')).toBeCloseTo(4258.5883, 4);
    expect(packageBaseQuantity(2, 1, 'gal')).toBeCloseTo(7570.823568, 6);
    expect(packageBaseQuantity(1, 18, 'ea')).toBe(18);
  });

  it.each<[number, number, UnitCode]>([
    [0, 1, 'g'],
    [1.5, 1, 'g'],
    [1, 0, 'g'],
    [1, -1, 'g'],
  ])('rejects invalid input %j', (pack, qty, unit) => {
    expect(() => packageBaseQuantity(pack, qty, unit)).toThrow(RangeError);
  });
});

describe('bridgeBase', () => {
  it('bridges count ↔ mass approximately with an average weight', () => {
    expect(bridgeBase(4, 'count', 'mass', 200)).toEqual({ baseQuantity: 800, approximate: true });
    expect(bridgeBase(800, 'mass', 'count', 200)).toEqual({ baseQuantity: 4, approximate: true });
  });
  it('is exact within a dimension', () => {
    expect(bridgeBase(5, 'mass', 'mass', null)).toEqual({ baseQuantity: 5, approximate: false });
  });
  it('refuses without an average weight, and never bridges volume', () => {
    expect(bridgeBase(4, 'count', 'mass', null)).toBeNull();
    expect(bridgeBase(4, 'volume', 'mass', 100)).toBeNull();
  });
});
