/**
 * Savings exports (SPEC Phase 6). Both read the immutable trip snapshots, so an export never
 * changes when prices do.
 * - CSV: RFC 4180, one row per trip item plus one fuel row per trip that used any, so the Saved
 *   column sums to the dashboard's total saved. Formula-looking text is escaped (core `csvCell`).
 * - PDF: summary + KPI table on page 1, then the per-trip table, ≤ 40 trips per page.
 */
import { centsToDecimal, toCsv, type CsvCell, type IsoDate } from '@sgs/core';
import type { Db } from '@sgs/db';
import { trips } from '@sgs/db';
import type { DashboardSummary, TripItem } from '@sgs/shared';
import { and, asc, between, eq } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { summary, type DateRange } from './dashboard.js';

interface Snapshot {
  readonly listName: string;
  readonly stores: { id: number; name: string }[];
  readonly baselineStore: { id: number; name: string };
  readonly items: TripItem[];
}

async function tripsIn(db: Db, userId: string, r: DateRange) {
  const rows = await db
    .select()
    .from(trips)
    .where(and(eq(trips.userId, userId), between(trips.shoppedOn, r.from, r.to)))
    .orderBy(asc(trips.shoppedOn), asc(trips.createdAt), asc(trips.id));
  return rows.map((t) => ({
    ...t,
    snap: t.plan as unknown as Snapshot,
    savings: t.savingsCents ?? t.baselineTotalCents - t.itemsTotalCents - t.fuelCostCents,
  }));
}

/** U+FEFF byte-order mark, written as a code point so source files stay plain ASCII. */
export const BOM = String.fromCharCode(0xfeff);

export const CSV_HEADER = [
  'Date',
  'Trip ID',
  'List',
  'Type',
  'Store',
  'Item',
  'Product',
  'Category',
  'Packages',
  'Paid ($)',
  'Baseline store',
  'Baseline ($)',
  'Saved ($)',
] as const;

export async function savingsCsv(db: Db, userId: string, r: DateRange): Promise<string> {
  const rows: CsvCell[][] = [[...CSV_HEADER]];
  for (const t of await tripsIn(db, userId, r)) {
    const storeName = (id: number) => t.snap.stores.find((s) => s.id === id)?.name ?? '';
    for (const i of t.snap.items) {
      rows.push([
        t.shoppedOn,
        t.id,
        t.snap.listName,
        'item',
        storeName(i.storeId),
        i.title,
        i.productName,
        i.categoryName,
        i.packages,
        centsToDecimal(i.lineCents),
        t.snap.baselineStore.name,
        centsToDecimal(i.baselineLineCents),
        centsToDecimal(i.baselineLineCents - i.lineCents),
      ]);
    }
    if (t.fuelCostCents > 0) {
      rows.push([
        t.shoppedOn,
        t.id,
        t.snap.listName,
        'fuel',
        t.snap.stores.map((s) => s.name).join(' + '),
        `Fuel, ${t.distanceMiles.toFixed(1)} mi round trip`,
        null,
        null,
        null,
        centsToDecimal(t.fuelCostCents),
        t.snap.baselineStore.name,
        centsToDecimal(0),
        centsToDecimal(-t.fuelCostCents),
      ]);
    }
  }
  // BOM so Excel opens UTF-8 correctly; RFC 4180 parsers (and Sheets) ignore it.
  return BOM + toCsv(rows);
}

export const PDF_TRIPS_PER_PAGE = 40;

const money = (c: number) => {
  const abs = Math.abs(c);
  const s = `$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
  return c < 0 ? `-${s}` : s;
};
const longDate = (d: IsoDate) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Money text used in the PDF, exported so tests compare against the API with the same format. */
export const pdfMoney = money;

export async function savingsPdf(
  db: Db,
  userId: string,
  r: DateRange,
  opts: { generatedAt: Date; demoPrices: boolean },
): Promise<Buffer> {
  const [kpi, list] = await Promise.all([summary(db, userId, r), tripsIn(db, userId, r)]);
  const doc = new PDFDocument({
    size: 'LETTER',
    margin: 36,
    autoFirstPage: true,
    info: {
      Title: 'Smart Grocery Saver savings report',
      Author: 'Smart Grocery Saver',
      CreationDate: opts.generatedAt,
      ModDate: opts.generatedAt,
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    }),
  );

  const left = 36;
  const width = 612 - 72;
  const text = (s: string, x: number, y: number, o: PDFKit.Mixins.TextOptions = {}) =>
    doc.text(s, x, y, { lineBreak: false, ...o });

  // Page 1: summary + KPIs.
  doc.font('Helvetica-Bold').fontSize(18);
  text('Savings report', left, 36);
  doc.font('Helvetica').fontSize(10).fillColor('#333333');
  text(`${longDate(r.from)} - ${longDate(r.to)}`, left, 60);
  text(
    `Generated ${opts.generatedAt.toISOString().slice(0, 10)}${opts.demoPrices ? '  ·  Demo prices: not real store prices' : ''}`,
    left,
    74,
  );
  const kpis: [string, string][] = kpiRows(kpi);
  let y = 100;
  doc.fillColor('#000000');
  for (const [label, value] of kpis) {
    doc.font('Helvetica').fontSize(10);
    text(label, left, y);
    doc.font('Helvetica-Bold');
    text(value, left + 200, y);
    y += 15;
  }

  // Trip table.
  const cols = [
    { h: 'Date', x: 0, w: 70 },
    { h: 'List', x: 72, w: 120 },
    { h: 'Stores', x: 194, w: 136 },
    { h: 'Spent', x: 332, w: 66, right: true },
    { h: 'Baseline', x: 400, w: 66, right: true },
    { h: 'Saved', x: 468, w: 72, right: true },
  ];
  const header = (atY: number) => {
    doc.font('Helvetica-Bold').fontSize(9);
    for (const c of cols) text(c.h, left + c.x, atY, c.right ? { width: c.w, align: 'right' } : {});
    doc
      .moveTo(left, atY + 12)
      .lineTo(left + width, atY + 12)
      .lineWidth(0.5)
      .stroke('#999999');
  };
  y += 10;
  if (list.length === 0) {
    doc.font('Helvetica').fontSize(10);
    text('No trips in this period.', left, y);
  }
  for (let i = 0; i < list.length; i++) {
    if (i % PDF_TRIPS_PER_PAGE === 0) {
      if (i > 0) {
        doc.addPage();
        y = 36;
      }
      header(y);
      y += 16;
    }
    const t = list[i];
    if (!t) continue;
    doc.font('Helvetica').fontSize(9).fillColor('#000000');
    const cells = [
      longDate(t.shoppedOn),
      clip(t.snap.listName, 24),
      clip(t.snap.stores.map((s) => s.name).join(' + '), 28),
      money(t.itemsTotalCents + t.fuelCostCents),
      money(t.baselineTotalCents),
      money(t.savings),
    ];
    cols.forEach((c, k) =>
      text(cells[k] ?? '', left + c.x, y, c.right ? { width: c.w, align: 'right' } : {}),
    );
    y += 12;
  }
  doc.end();
  return done;
}

export function kpiRows(kpi: DashboardSummary): [string, string][] {
  return [
    ['Trips', String(kpi.tripCount)],
    ['Total saved', money(kpi.totalSavedCents)],
    ['Average saved', kpi.avgSavingsPct === null ? '-' : `${kpi.avgSavingsPct.toFixed(1)}%`],
    ['Spent (items + fuel)', money(kpi.totalSpentCents)],
    ['Baseline total', money(kpi.baselineTotalCents)],
    ['Fuel', money(kpi.fuelSpentCents)],
    [
      'Best store',
      kpi.bestStore ? `${kpi.bestStore.name} (${money(kpi.bestStore.savedCents)} saved)` : '-',
    ],
  ];
}
