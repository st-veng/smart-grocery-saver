/** Grocery lists, items and templates (SPEC Phase 3). Every query is scoped to the owner. */
import { dimensionOf, parseListLine, type UnitCode } from '@sgs/core';
import { categories, groceryLists, listItems, storeItems, type Db } from '@sgs/db';
import type {
  AddItemRequest,
  CreateListRequest,
  ListDetail,
  ListGroup,
  ListItem,
  ListSummary,
  ProductSummary,
  UpdateItemRequest,
  UpdateListRequest,
} from '@sgs/shared';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { AppError } from '../errors.js';
import { fitUnit, matchProductName, productsByIds } from './catalog.js';

type ListRow = typeof groceryLists.$inferSelect;
type ItemRow = typeof listItems.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const notFound = () => new AppError('NOT_FOUND', 404, 'List not found');
const invalid = (message: string, path: string) =>
  new AppError('VALIDATION_FAILED', 422, message, [{ path: [path], message }]);

/** A list the user owns (lists and their own templates). Other users' lists are 404, never 403. */
export async function ownedList(db: Db | Tx, userId: string, listId: string): Promise<ListRow> {
  const [row] = await db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.id, listId), eq(groceryLists.userId, userId)));
  if (!row) throw notFound();
  return row;
}

/** A template the user may read: a system template or one of their own. */
async function visibleTemplate(db: Db, userId: string, id: string): Promise<ListRow> {
  const [row] = await db
    .select()
    .from(groceryLists)
    .where(
      and(
        eq(groceryLists.id, id),
        eq(groceryLists.isTemplate, true),
        or(isNull(groceryLists.userId), eq(groceryLists.userId, userId)),
      ),
    );
  if (!row) throw new AppError('NOT_FOUND', 404, 'Template not found');
  return row;
}

function toItem(row: ItemRow, product: ProductSummary | null): ListItem {
  return {
    id: row.id,
    position: row.position,
    rawText: row.rawText,
    product,
    quantity: row.quantity,
    unit: row.unit,
    matchMode: row.matchMode,
    brand: row.brand,
    storeItemId: row.storeItemId,
    categoryId: row.categoryId ?? product?.categoryId ?? null,
    categoryOverride: row.categoryId !== null,
    checked: row.checked,
    notes: row.notes,
  };
}

async function summaries(db: Db, rows: readonly ListRow[]): Promise<ListSummary[]> {
  if (rows.length === 0) return [];
  const counts = await db
    .select({
      listId: listItems.listId,
      total: sql<number>`count(*)::int`,
      checked: sql<number>`count(*) FILTER (WHERE ${listItems.checked})::int`,
    })
    .from(listItems)
    .where(
      inArray(
        listItems.listId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(listItems.listId);
  const by = new Map(counts.map((c) => [c.listId, c]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isTemplate: r.isTemplate,
    system: r.userId === null,
    archived: r.archivedAt !== null,
    itemCount: by.get(r.id)?.total ?? 0,
    checkedCount: by.get(r.id)?.checked ?? 0,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function listDetail(db: Db, list: ListRow): Promise<ListDetail> {
  const [summary] = await summaries(db, [list]);
  if (!summary) throw notFound();
  const rows = await db
    .select()
    .from(listItems)
    .where(eq(listItems.listId, list.id))
    .orderBy(asc(listItems.position), asc(listItems.createdAt));
  const prods = await productsByIds(db, [
    ...new Set(rows.flatMap((r) => (r.productId ? [r.productId] : []))),
  ]);
  const cats = await db.select().from(categories);
  const catById = new Map(cats.map((c) => [c.id, c]));
  const groups = new Map<number | null, ListItem[]>();
  for (const r of rows) {
    const item = toItem(r, r.productId ? (prods.get(r.productId) ?? null) : null);
    const key = item.categoryId !== null && catById.has(item.categoryId) ? item.categoryId : null;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const ordered: ListGroup[] = [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return (catById.get(a)?.sortOrder ?? 0) - (catById.get(b)?.sortOrder ?? 0);
    })
    .map(([categoryId, items]) => ({
      categoryId,
      categoryName: categoryId === null ? 'Other' : (catById.get(categoryId)?.name ?? 'Other'),
      items,
    }));
  return { ...summary, groups: ordered };
}

export async function listLists(
  db: Db,
  userId: string,
  opts: { archived: boolean; limit: number; cursor: number },
): Promise<{ lists: ListSummary[]; nextCursor: string | null }> {
  const rows = await db
    .select()
    .from(groceryLists)
    .where(
      and(
        eq(groceryLists.userId, userId),
        eq(groceryLists.isTemplate, false),
        opts.archived ? isNotNull(groceryLists.archivedAt) : isNull(groceryLists.archivedAt),
      ),
    )
    .orderBy(desc(groceryLists.updatedAt), asc(groceryLists.id))
    .limit(opts.limit + 1)
    .offset(opts.cursor);
  return {
    lists: await summaries(db, rows.slice(0, opts.limit)),
    nextCursor: rows.length > opts.limit ? String(opts.cursor + opts.limit) : null,
  };
}

export async function listTemplates(db: Db, userId: string): Promise<ListSummary[]> {
  const rows = await db
    .select()
    .from(groceryLists)
    .where(
      and(
        eq(groceryLists.isTemplate, true),
        isNull(groceryLists.archivedAt),
        or(isNull(groceryLists.userId), eq(groceryLists.userId, userId)),
      ),
    )
    .orderBy(sql`${groceryLists.userId} IS NOT NULL`, asc(groceryLists.name));
  return summaries(db, rows);
}

export async function getTemplate(db: Db, userId: string, id: string): Promise<ListDetail> {
  return listDetail(db, await visibleTemplate(db, userId, id));
}

/** Copy every item of `fromId` into `toId` (deep copy; checks cleared). */
async function copyItems(tx: Tx, fromId: string, toId: string, now: Date): Promise<void> {
  const items = await tx
    .select()
    .from(listItems)
    .where(eq(listItems.listId, fromId))
    .orderBy(asc(listItems.position));
  if (items.length === 0) return;
  await tx.insert(listItems).values(
    items.map((i, position) => ({
      listId: toId,
      position,
      rawText: i.rawText,
      productId: i.productId,
      quantity: i.quantity,
      unit: i.unit,
      matchMode: i.matchMode,
      brand: i.brand,
      storeItemId: i.storeItemId,
      categoryId: i.categoryId,
      checked: false,
      notes: i.notes,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

export async function createList(
  db: Db,
  userId: string,
  input: CreateListRequest,
  now: Date,
): Promise<ListRow> {
  const template = input.fromTemplateId
    ? await visibleTemplate(db, userId, input.fromTemplateId)
    : null;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(groceryLists)
      .values({
        userId,
        name: input.name,
        description: input.description ?? template?.description ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error('list insert failed');
    if (template) await copyItems(tx, template.id, row.id, now);
    return row;
  });
}

export async function copyList(
  db: Db,
  userId: string,
  listId: string,
  opts: { asTemplate: boolean; name?: string | undefined },
  now: Date,
): Promise<ListRow> {
  const src = await ownedList(db, userId, listId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(groceryLists)
      .values({
        userId,
        name: opts.name ?? (opts.asTemplate ? src.name : `${src.name} (copy)`).slice(0, 120),
        description: src.description,
        isTemplate: opts.asTemplate,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error('list insert failed');
    await copyItems(tx, src.id, row.id, now);
    return row;
  });
}

export async function updateList(
  db: Db,
  userId: string,
  listId: string,
  input: UpdateListRequest,
  now: Date,
): Promise<ListRow> {
  await ownedList(db, userId, listId);
  const patch: Partial<typeof groceryLists.$inferInsert> = { updatedAt: now };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.archived !== undefined) patch.archivedAt = input.archived ? now : null;
  const [row] = await db
    .update(groceryLists)
    .set(patch)
    .where(eq(groceryLists.id, listId))
    .returning();
  if (!row) throw notFound();
  return row;
}

export async function deleteList(db: Db, userId: string, listId: string): Promise<void> {
  await ownedList(db, userId, listId);
  await db.delete(groceryLists).where(eq(groceryLists.id, listId));
}

async function touch(db: Db | Tx, listId: string, now: Date): Promise<void> {
  await db.update(groceryLists).set({ updatedAt: now }).where(eq(groceryLists.id, listId));
}

async function nextPosition(db: Db | Tx, listId: string): Promise<number> {
  const [r] = await db
    .select({ max: sql<number | null>`max(${listItems.position})` })
    .from(listItems)
    .where(eq(listItems.listId, listId));
  return (r?.max ?? -1) + 1;
}

interface ItemFields {
  productId: string | null;
  unit: UnitCode | null;
  matchMode: 'any' | 'brand' | 'exact_item';
  brand: string | null;
  storeItemId: string | null;
}

/** Validate the product/unit/brand/store-item combination; 422 with field paths when inconsistent. */
async function checkItemFields(db: Db, f: ItemFields): Promise<ProductSummary | null> {
  if (f.productId === null) {
    if (f.unit !== null) throw invalid('Pick a product before choosing a unit', 'unit');
    if (f.matchMode !== 'any')
      throw invalid('Pick a product before choosing a brand or item', 'matchMode');
    return null;
  }
  const product = (await productsByIds(db, [f.productId])).get(f.productId);
  if (!product) throw invalid('Unknown product', 'productId');
  if (f.unit !== null && fitUnit(f.unit, product) !== f.unit) {
    throw invalid(
      `${f.unit} does not fit ${product.name} (sold by ${dimensionOf(product.defaultUnit)})`,
      'unit',
    );
  }
  if (f.matchMode === 'brand' && !f.brand) throw invalid('Enter a brand', 'brand');
  if (f.matchMode === 'exact_item' && !f.storeItemId)
    throw invalid('Pick a store item', 'storeItemId');
  if (f.storeItemId) {
    const [si] = await db
      .select({ productId: storeItems.productId })
      .from(storeItems)
      .where(eq(storeItems.id, f.storeItemId));
    if (si?.productId !== f.productId)
      throw invalid('That store item is not this product', 'storeItemId');
  }
  return product;
}

export async function addItem(
  db: Db,
  userId: string,
  listId: string,
  input: AddItemRequest,
  now: Date,
): Promise<ListItem> {
  await ownedList(db, userId, listId);
  let productId = input.productId;
  let quantity = input.quantity;
  let unit = input.unit;
  let notes = input.notes;
  if (productId === undefined) {
    // Free text: read "2 lb ground beef" and auto-match only when confident.
    const parsed = parseListLine(input.rawText);
    const m = await matchProductName(db, parsed?.name ?? input.rawText);
    productId = m.status === 'matched' ? m.productId : null;
    quantity ??= parsed?.quantity;
    if (unit === undefined && productId) {
      const p = (await productsByIds(db, [productId])).get(productId);
      unit = p ? fitUnit(parsed?.unit ?? null, p) : null;
    }
    notes ??= parsed?.notes ?? null;
  }
  const fields: ItemFields = {
    productId: productId ?? null,
    unit: unit ?? null,
    matchMode: input.matchMode ?? (input.brand ? 'brand' : 'any'),
    brand: input.brand ?? null,
    storeItemId: input.storeItemId ?? null,
  };
  const product = await checkItemFields(db, fields);
  const [row] = await db
    .insert(listItems)
    .values({
      listId,
      position: await nextPosition(db, listId),
      rawText: input.rawText,
      ...fields,
      quantity: quantity ?? 1,
      notes: notes ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error('item insert failed');
  await touch(db, listId, now);
  return toItem(row, product);
}

async function ownedItem(db: Db, userId: string, listId: string, itemId: string): Promise<ItemRow> {
  await ownedList(db, userId, listId);
  const [row] = await db
    .select()
    .from(listItems)
    .where(and(eq(listItems.id, itemId), eq(listItems.listId, listId)));
  if (!row) throw new AppError('NOT_FOUND', 404, 'Item not found');
  return row;
}

export async function updateItem(
  db: Db,
  userId: string,
  listId: string,
  itemId: string,
  input: UpdateItemRequest,
  now: Date,
): Promise<ListItem> {
  const cur = await ownedItem(db, userId, listId, itemId);
  const productChanged = input.productId !== undefined && input.productId !== cur.productId;
  const fields: ItemFields = {
    productId: input.productId !== undefined ? input.productId : cur.productId,
    // A new product resets unit / brand / exact item unless the request sets them too.
    unit: input.unit !== undefined ? input.unit : productChanged ? null : cur.unit,
    matchMode: input.matchMode ?? (productChanged ? 'any' : cur.matchMode),
    brand: input.brand !== undefined ? input.brand : productChanged ? null : cur.brand,
    storeItemId:
      input.storeItemId !== undefined ? input.storeItemId : productChanged ? null : cur.storeItemId,
  };
  if (input.brand !== undefined && input.matchMode === undefined)
    fields.matchMode = input.brand ? 'brand' : 'any';
  const product = await checkItemFields(db, fields);
  if (input.categoryId !== undefined && input.categoryId !== null) {
    const [c] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, input.categoryId));
    if (!c) throw invalid('Unknown category', 'categoryId');
  }
  const [row] = await db
    .update(listItems)
    .set({
      ...fields,
      ...(input.rawText !== undefined ? { rawText: input.rawText } : {}),
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.checked !== undefined ? { checked: input.checked } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: now,
    })
    .where(eq(listItems.id, itemId))
    .returning();
  if (!row) throw new AppError('NOT_FOUND', 404, 'Item not found');
  await touch(db, listId, now);
  return toItem(row, product);
}

export async function deleteItem(
  db: Db,
  userId: string,
  listId: string,
  itemId: string,
  now: Date,
): Promise<void> {
  await ownedItem(db, userId, listId, itemId);
  await db.delete(listItems).where(eq(listItems.id, itemId));
  await touch(db, listId, now);
}

/** Set the full item order. The ids must be exactly the list's items. */
export async function reorderItems(
  db: Db,
  userId: string,
  listId: string,
  itemIds: readonly string[],
  now: Date,
): Promise<void> {
  await ownedList(db, userId, listId);
  const current = await db
    .select({ id: listItems.id })
    .from(listItems)
    .where(eq(listItems.listId, listId));
  const have = new Set(current.map((c) => c.id));
  const given = new Set(itemIds);
  if (
    given.size !== itemIds.length ||
    given.size !== have.size ||
    [...given].some((id) => !have.has(id))
  ) {
    throw invalid('Send every item of the list exactly once', 'itemIds');
  }
  await db.transaction(async (tx) => {
    for (const [position, id] of itemIds.entries()) {
      await tx.update(listItems).set({ position, updatedAt: now }).where(eq(listItems.id, id));
    }
    await touch(tx, listId, now);
  });
}

/** Insert many already-resolved items (import commit). */
export async function appendItems(
  db: Db,
  listId: string,
  items: readonly {
    rawText: string;
    productId: string | null;
    quantity: number;
    unit: UnitCode | null;
    brand: string | null;
    notes: string | null;
  }[],
  now: Date,
): Promise<void> {
  if (items.length === 0) return;
  const start = await nextPosition(db, listId);
  await db.insert(listItems).values(
    items.map((i, k) => ({
      listId,
      position: start + k,
      rawText: i.rawText,
      productId: i.productId,
      quantity: i.quantity,
      unit: i.productId ? i.unit : null,
      matchMode: i.productId && i.brand ? ('brand' as const) : ('any' as const),
      brand: i.productId ? i.brand : null,
      notes: i.notes,
      createdAt: now,
      updatedAt: now,
    })),
  );
  await touch(db, listId, now);
}
