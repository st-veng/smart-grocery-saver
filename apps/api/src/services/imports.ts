/** CSV / pasted-text import: stateless preview, then commit of the reviewed lines (SPEC Phase 3). */
import {
  csvToImportLines,
  CsvError,
  ImportTooLargeError,
  MAX_IMPORT_LINES,
  textToImportLines,
} from '@sgs/core';
import { groceryLists, type Db } from '@sgs/db';
import type { ImportCommitRequest, ImportPreviewRequest, ImportPreviewResponse } from '@sgs/shared';
import { AppError } from '../errors.js';
import { fitUnit, matchProductName, productsByIds } from './catalog.js';
import { appendItems, ownedList } from './lists.js';

export async function previewImport(
  db: Db,
  input: ImportPreviewRequest,
): Promise<ImportPreviewResponse> {
  let parsed;
  try {
    parsed =
      input.format === 'csv' ? csvToImportLines(input.content) : textToImportLines(input.content);
  } catch (e) {
    if (e instanceof ImportTooLargeError) {
      throw new AppError(
        'VALIDATION_FAILED',
        422,
        `Imports are limited to ${String(MAX_IMPORT_LINES)} lines (this has ${String(e.count)})`,
      );
    }
    if (e instanceof CsvError) {
      throw new AppError('VALIDATION_FAILED', 422, e.message, [
        { path: ['content'], message: e.message, lineNo: e.lineNo },
      ]);
    }
    throw e;
  }
  const matches = await Promise.all(parsed.lines.map((l) => matchProductName(db, l.name)));
  const prods = await productsByIds(db, [
    ...new Set(matches.flatMap((m) => (m.productId ? [m.productId] : []))),
  ]);
  return {
    format: input.format,
    errors: parsed.errors,
    lines: parsed.lines.map((l, i) => {
      const m = matches[i] ?? { status: 'unmatched' as const, productId: null, candidates: [] };
      const product = m.productId ? prods.get(m.productId) : undefined;
      return {
        lineNo: l.lineNo,
        raw: l.raw,
        name: l.name,
        quantity: l.quantity,
        unit: product ? fitUnit(l.unit, product) : l.unit,
        brand: l.brand,
        notes: l.notes,
        status: m.status,
        productId: m.status === 'matched' ? m.productId : null,
        candidates: m.candidates,
      };
    }),
  };
}

/**
 * Commit reviewed lines exactly as sent: a line without productId stays free text — the server
 * never auto-matches on commit, so ambiguous lines cannot slip in unreviewed.
 */
export async function commitImport(
  db: Db,
  userId: string,
  input: ImportCommitRequest,
  now: Date,
): Promise<string> {
  const ids = [...new Set(input.lines.flatMap((l) => (l.productId ? [l.productId] : [])))];
  const prods = await productsByIds(db, ids);
  const unknown = input.lines.findIndex((l) => l.productId && !prods.has(l.productId));
  if (unknown >= 0) {
    throw new AppError('VALIDATION_FAILED', 422, 'Unknown product', [
      { path: ['lines', unknown, 'productId'], message: 'Unknown product' },
    ]);
  }
  let listId = input.listId;
  if (listId) await ownedList(db, userId, listId);
  else {
    const [row] = await db
      .insert(groceryLists)
      .values({
        userId,
        name: input.newListName ?? 'Imported list',
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: groceryLists.id });
    if (!row) throw new Error('list insert failed');
    listId = row.id;
  }
  await appendItems(
    db,
    listId,
    input.lines.map((l) => {
      const p = l.productId ? prods.get(l.productId) : undefined;
      return {
        rawText: l.raw,
        productId: p ? p.id : null,
        quantity: l.quantity,
        unit: p ? fitUnit(l.unit, p) : null,
        brand: l.brand ?? null,
        notes: l.notes ?? null,
      };
    }),
    now,
  );
  return listId;
}
