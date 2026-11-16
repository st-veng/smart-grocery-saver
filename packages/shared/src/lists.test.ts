import { describe, expect, it } from 'vitest';
import { UNIT_CODES as CORE_UNITS } from '../../core/src/units/table.js';
import {
  AddItemRequest,
  ImportCommitRequest,
  ImportPreviewRequest,
  ReorderRequest,
  UNIT_CODES,
  UpdateItemRequest,
} from './lists.js';

const id = '11111111-1111-4111-8111-111111111111';

describe('lists contract', () => {
  it('unit codes match @sgs/core', () => {
    expect([...UNIT_CODES]).toEqual([...CORE_UNITS]);
  });

  it('item requests are strict and validate quantity', () => {
    expect(AddItemRequest.parse({ rawText: ' milk ' })).toEqual({ rawText: 'milk' });
    expect(AddItemRequest.safeParse({ rawText: 'milk', quantity: 0 }).success).toBe(false);
    expect(AddItemRequest.safeParse({ rawText: 'milk', listId: id }).success).toBe(false);
    expect(UpdateItemRequest.safeParse({ checked: true }).success).toBe(true);
    expect(UpdateItemRequest.safeParse({ unit: 'furlong' }).success).toBe(false);
  });

  it('import requests enforce limits and a single destination', () => {
    expect(ImportPreviewRequest.safeParse({ format: 'csv', content: '' }).success).toBe(false);
    const line = { raw: 'milk', productId: null, quantity: 1, unit: null };
    expect(ImportCommitRequest.safeParse({ newListName: 'Week', lines: [line] }).success).toBe(
      true,
    );
    expect(ImportCommitRequest.safeParse({ lines: [line] }).success).toBe(false);
    expect(
      ImportCommitRequest.safeParse({ listId: id, newListName: 'x', lines: [line] }).success,
    ).toBe(false);
    expect(
      ImportCommitRequest.safeParse({ listId: id, lines: Array(501).fill(line) }).success,
    ).toBe(false);
    expect(ReorderRequest.safeParse({ itemIds: [] }).success).toBe(false);
  });
});
