/** RFC 4180 CSV parsing and grocery-list CSV import (SPEC Phase 3). */
import type { UnitCode } from '../units/table.js';
import { isContainerWord, measureUnit, parseListLine } from './parse-line.js';

export interface CsvRow {
  /** 1-based physical line where the record starts. */
  readonly lineNo: number;
  readonly cells: readonly string[];
}

export class CsvError extends Error {
  constructor(
    readonly lineNo: number,
    message: string,
  ) {
    super(message);
    this.name = 'CsvError';
  }
}

/** Parse CSV text: quoted fields, "" escapes, embedded commas/newlines, CRLF, BOM. Blank lines skipped. */
export function parseCsv(input: string): CsvRow[] {
  const text = input.startsWith('\uFEFF') ? input.slice(1) : input;
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowStart = 1;
  let fieldStarted = false;

  const endRow = () => {
    cells.push(cell);
    if (!(cells.length === 1 && cells[0]?.trim() === '')) rows.push({ lineNo: rowStart, cells });
    cells = [];
    cell = '';
    fieldStarted = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === '\n') line++;
        cell += c;
      }
      continue;
    }
    if (c === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else if (c === ',') {
      cells.push(cell);
      cell = '';
      fieldStarted = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
      line++;
      rowStart = line;
    } else {
      cell += c;
      fieldStarted = true;
    }
  }
  if (quoted) throw new CsvError(rowStart, `Unclosed quote starting on line ${String(rowStart)}`);
  if (cell !== '' || cells.length > 0) endRow();
  return rows;
}

export interface ImportLine {
  readonly lineNo: number;
  readonly raw: string;
  readonly name: string;
  readonly quantity: number;
  readonly unit: UnitCode | null;
  readonly brand: string | null;
  readonly notes: string | null;
}

export interface ImportLineError {
  readonly lineNo: number;
  readonly message: string;
}

export interface ImportParseResult {
  readonly lines: ImportLine[];
  readonly errors: ImportLineError[];
}

export const MAX_IMPORT_LINES = 500;

export class ImportTooLargeError extends Error {
  constructor(readonly count: number) {
    super(`Too many lines (${String(count)}); the limit is ${String(MAX_IMPORT_LINES)}`);
    this.name = 'ImportTooLargeError';
  }
}

const HEADERS: Readonly<
  Record<'item' | 'quantity' | 'unit' | 'brand' | 'notes', readonly string[]>
> = {
  item: ['item', 'items', 'name', 'product', 'description', 'grocery', 'groceries'],
  quantity: ['quantity', 'qty', 'amount', 'count', 'how many'],
  unit: ['unit', 'units', 'uom', 'measure'],
  brand: ['brand', 'brand name'],
  notes: ['notes', 'note', 'comment', 'comments'],
};

function parseQuantity(text: string): number | null {
  const t = text.trim();
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac && Number(frac[2]) > 0) return Number(frac[1]) / Number(frac[2]);
  return /^\d*\.?\d+$/.test(t) ? Number(t) : null;
}

/** Grocery CSV → import lines. Requires a header row with an item column; other columns optional. */
export function csvToImportLines(text: string): ImportParseResult {
  const rows = parseCsv(text);
  const [header, ...body] = rows;
  if (!header) return { lines: [], errors: [{ lineNo: 1, message: 'The file is empty' }] };
  if (body.length > MAX_IMPORT_LINES) throw new ImportTooLargeError(body.length);
  const names = header.cells.map((c) => c.trim().toLowerCase());
  const col = (k: keyof typeof HEADERS) => names.findIndex((n) => HEADERS[k].includes(n));
  const idx = {
    item: col('item'),
    quantity: col('quantity'),
    unit: col('unit'),
    brand: col('brand'),
    notes: col('notes'),
  };
  if (idx.item < 0) {
    return {
      lines: [],
      errors: [{ lineNo: header.lineNo, message: 'Add a header row with an "item" column' }],
    };
  }
  const lines: ImportLine[] = [];
  const errors: ImportLineError[] = [];
  const get = (r: CsvRow, i: number) => (i >= 0 ? (r.cells[i] ?? '').trim() : '');
  for (const r of body) {
    const item = get(r, idx.item);
    if (item === '') {
      errors.push({ lineNo: r.lineNo, message: 'Missing item name' });
      continue;
    }
    const qtyText = get(r, idx.quantity);
    const unitText = get(r, idx.unit);
    const parsedItem = parseListLine(item);
    let quantity = parsedItem?.quantity ?? 1;
    let unit: UnitCode | null = parsedItem?.unit ?? null;
    const name = parsedItem?.name ?? item;
    if (qtyText !== '') {
      const q = parseQuantity(qtyText);
      if (q === null || !(q > 0) || q > 9999) {
        errors.push({ lineNo: r.lineNo, message: `Quantity "${qtyText}" is not a number` });
        continue;
      }
      quantity = q;
    }
    if (unitText !== '') {
      const u = measureUnit(unitText);
      if (u) unit = u;
      else if (isContainerWord(unitText)) unit = null;
      else {
        errors.push({ lineNo: r.lineNo, message: `Unknown unit "${unitText}"` });
        continue;
      }
    }
    lines.push({
      lineNo: r.lineNo,
      raw: r.cells.join(',').trim(),
      name,
      quantity: Math.round(quantity * 1000) / 1000,
      unit,
      brand: get(r, idx.brand) || null,
      notes: get(r, idx.notes) || parsedItem?.notes || null,
    });
  }
  return { lines, errors };
}

/** Pasted text → import lines (one item per line; blank and # comment lines ignored). */
export function textToImportLines(text: string): ImportParseResult {
  const physical = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const nonBlank = physical.filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  if (nonBlank.length > MAX_IMPORT_LINES) throw new ImportTooLargeError(nonBlank.length);
  const lines: ImportLine[] = [];
  const errors: ImportLineError[] = [];
  physical.forEach((l, i) => {
    if (l.trim() === '' || l.trim().startsWith('#')) return;
    const p = parseListLine(l);
    if (!p) {
      errors.push({ lineNo: i + 1, message: `Could not read "${l.trim()}"` });
      return;
    }
    lines.push({
      lineNo: i + 1,
      raw: p.raw,
      name: p.name,
      quantity: p.quantity,
      unit: p.unit,
      brand: null,
      notes: p.notes,
    });
  });
  return { lines, errors };
}
