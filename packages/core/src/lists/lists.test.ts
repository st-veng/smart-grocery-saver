import { describe, expect, it } from 'vitest';
import type { UnitCode } from '../units/table.js';
import {
  csvToImportLines,
  CsvError,
  ImportTooLargeError,
  parseCsv,
  textToImportLines,
} from './csv.js';
import { parseListLine } from './parse-line.js';

type Expect = [name: string, quantity: number, unit: UnitCode | null, notes?: string | null];
const LINES: [string, Expect | null][] = [
  // quantity + measure
  ['2 lb ground beef', ['ground beef', 2, 'lb']],
  ['2 lbs ground beef', ['ground beef', 2, 'lb']],
  ['2 pounds of ground beef', ['ground beef', 2, 'lb']],
  ['1.5 lb chicken thighs', ['chicken thighs', 1.5, 'lb']],
  ['1 1/2 lb salmon', ['salmon', 1.5, 'lb']],
  ['1/2 gal oj', ['oj', 0.5, 'gal']],
  ['½ gallon milk', ['milk', 0.5, 'gal']],
  ['half gallon milk', ['milk', 0.5, 'gal']],
  ['a gallon of milk', ['milk', 1, 'gal']],
  ['2 gal whole milk', ['whole milk', 2, 'gal']],
  ['16oz shredded cheddar', ['shredded cheddar', 16, 'oz']],
  ['16 oz shredded cheddar', ['shredded cheddar', 16, 'oz']],
  ['64 fl oz almond milk', ['almond milk', 64, 'fl_oz']],
  ['750 ml olive oil', ['olive oil', 750, 'ml']],
  ['2 L soda', ['soda', 2, 'l']],
  ['5 kg rice', ['rice', 5, 'kg']],
  ['500 g pasta', ['pasta', 500, 'g']],
  ['1 qt half and half', ['half and half', 1, 'qt']],
  ['3# potatoes', ['potatoes', 3, 'lb']],
  // dozens and counts
  ['dozen eggs', ['eggs', 1, 'dozen']],
  ['a dozen eggs', ['eggs', 1, 'dozen']],
  ['2 dozen eggs', ['eggs', 2, 'dozen']],
  ['18 ct eggs', ['eggs', 18, 'ea']],
  ['3 avocados', ['avocados', 3, null]],
  ['three lemons', ['lemons', 3, null]],
  ['a couple of limes', ['limes', 2, null]],
  // containers count packages
  ['2 cans black beans', ['black beans', 2, null]],
  ['1 bag of carrots', ['carrots', 1, null]],
  ['2 loaves white bread', ['white bread', 2, null]],
  ['a box of cereal', ['cereal', 1, null]],
  ['3 jars salsa', ['salsa', 3, null]],
  // trailing multipliers
  ['milk x2', ['milk', 2, null]],
  ['milk × 2', ['milk', 2, null]],
  ['bread (2)', ['bread', 2, null]],
  ['bananas - 3', ['bananas', 3, null]],
  ['2 lb ground beef x2', ['ground beef', 4, 'lb']],
  // bullets, checkboxes, numbering, notes
  ['- eggs', ['eggs', 1, null]],
  ['* bananas', ['bananas', 1, null]],
  ['[ ] coffee', ['coffee', 1, null]],
  ['1. tortillas', ['tortillas', 1, null]],
  ['2) salsa', ['salsa', 1, null]],
  ['bananas (ripe ones)', ['bananas', 1, null, 'ripe ones']],
  ['  Peanut Butter  ', ['Peanut Butter', 1, null]],
  // plain names that look like units/containers are kept as names
  ['milk', ['milk', 1, null]],
  ['2% milk', ['2% milk', 1, null]],
  ['2 gal 2% milk', ['2% milk', 2, 'gal']],
  ['1% milk x2', ['1% milk', 2, null]],
  ['ice cream', ['ice cream', 1, null]],
  ['bars of soap', ['bars of soap', 1, null]],
  // not items
  ['', null],
  ['   ', null],
  ['# pantry', null],
  ['2 lb', null],
  ['123', null],
  ['0 eggs', null],
];

describe('parseListLine', () => {
  it('has at least 40 fixtures (SPEC Phase 3)', () => {
    expect(LINES.length).toBeGreaterThanOrEqual(40);
  });

  it.each(LINES)('%j', (input, expected) => {
    const p = parseListLine(input);
    if (expected === null) {
      expect(p).toBeNull();
      return;
    }
    const [name, quantity, unit, notes = null] = expected;
    expect(p).toEqual({ raw: input.trim(), name, quantity, unit, notes });
  });
});

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas and newlines, CRLF, BOM and blank lines', () => {
    const rows = parseCsv(
      '\uFEFFitem,notes\r\n"Beans, black","say ""hi"""\r\n\r\n"multi\nline",x\nlast,',
    );
    expect(rows).toEqual([
      { lineNo: 1, cells: ['item', 'notes'] },
      { lineNo: 2, cells: ['Beans, black', 'say "hi"'] },
      { lineNo: 4, cells: ['multi\nline', 'x'] },
      { lineNo: 6, cells: ['last', ''] },
    ]);
  });

  it('reports an unclosed quote with its line number', () => {
    expect(() => parseCsv('item\nok\n"broken,1\nmore')).toThrow(CsvError);
    try {
      parseCsv('item\nok\n"broken,1\nmore');
    } catch (e) {
      expect((e as CsvError).lineNo).toBe(3);
    }
  });
});

describe('csvToImportLines', () => {
  it('maps header variants case-insensitively', () => {
    const r = csvToImportLines(
      'Product,QTY,Unit,Brand,Notes\nWhole milk,2,gal,Borden,for the week\nEggs,18,ct,,',
    );
    expect(r.errors).toEqual([]);
    expect(r.lines).toEqual([
      {
        lineNo: 2,
        raw: 'Whole milk,2,gal,Borden,for the week',
        name: 'Whole milk',
        quantity: 2,
        unit: 'gal',
        brand: 'Borden',
        notes: 'for the week',
      },
      {
        lineNo: 3,
        raw: 'Eggs,18,ct,,',
        name: 'Eggs',
        quantity: 18,
        unit: 'ea',
        brand: null,
        notes: null,
      },
    ]);
  });

  it('falls back to quantities written inside the item text', () => {
    const r = csvToImportLines('item\n2 lb ground beef\n"milk x2"');
    expect(r.lines.map((l) => [l.name, l.quantity, l.unit])).toEqual([
      ['ground beef', 2, 'lb'],
      ['milk', 2, null],
    ]);
  });

  it('reports bad rows with line numbers and keeps the good ones', () => {
    const r = csvToImportLines(
      'item,quantity,unit\nmilk,two,gal\n,1,\nbeans,2,cans\ncheese,1,furlongs\nrice,1/2,lb',
    );
    expect(r.errors).toEqual([
      { lineNo: 2, message: 'Quantity "two" is not a number' },
      { lineNo: 3, message: 'Missing item name' },
      { lineNo: 5, message: 'Unknown unit "furlongs"' },
    ]);
    expect(r.lines.map((l) => [l.lineNo, l.name, l.quantity, l.unit])).toEqual([
      [4, 'beans', 2, null],
      [6, 'rice', 0.5, 'lb'],
    ]);
  });

  it('requires an item column and rejects more than 500 rows', () => {
    expect(csvToImportLines('foo,bar\n1,2').errors[0]?.message).toMatch(/"item" column/);
    expect(csvToImportLines('').errors[0]?.message).toBe('The file is empty');
    expect(() => csvToImportLines(`item\n${'milk\n'.repeat(501)}`)).toThrow(ImportTooLargeError);
    expect(csvToImportLines(`item\n${'milk\n'.repeat(500)}`).lines).toHaveLength(500);
  });
});

describe('textToImportLines', () => {
  it('parses each non-blank line and reports unreadable ones by line number', () => {
    const r = textToImportLines('2 lb ground beef\n\n# dairy\nmilk x2\n42\n3 avocados');
    expect(r.lines.map((l) => [l.lineNo, l.name])).toEqual([
      [1, 'ground beef'],
      [4, 'milk'],
      [6, 'avocados'],
    ]);
    expect(r.errors).toEqual([{ lineNo: 5, message: 'Could not read "42"' }]);
    expect(() => textToImportLines('milk\n'.repeat(501))).toThrow(ImportTooLargeError);
  });
});
