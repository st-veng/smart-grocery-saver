import { z } from 'zod';

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
export const UnitCode = z.enum(UNIT_CODES);
export const Dimension = z.enum(['mass', 'volume', 'count']);
export const MatchMode = z.enum(['any', 'brand', 'exact_item']);

export const Category = z.object({
  id: z.number().int(),
  slug: z.string(),
  name: z.string(),
  parentId: z.number().int().nullable(),
  icon: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type Category = z.infer<typeof Category>;
export const CategoriesResponse = z.object({ categories: z.array(Category) });

export const ProductSummary = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  categoryId: z.number().int(),
  categoryName: z.string(),
  dimension: Dimension,
  displayUnit: UnitCode,
  defaultQuantity: z.number(),
  defaultUnit: UnitCode,
  avgEachGrams: z.number().nullable(),
});
export type ProductSummary = z.infer<typeof ProductSummary>;

export const ProductsResponse = z.object({
  products: z.array(ProductSummary),
  nextCursor: z.string().nullable(),
});
export const ProductResponse = z.object({ product: ProductSummary, aliases: z.array(z.string()) });

export const ListItem = z.object({
  id: z.uuid(),
  position: z.number().int(),
  rawText: z.string(),
  product: ProductSummary.nullable(),
  quantity: z.number(),
  unit: UnitCode.nullable(),
  matchMode: MatchMode,
  brand: z.string().nullable(),
  storeItemId: z.uuid().nullable(),
  /** Effective category: the item's override, else the product's, else null ("Other"). */
  categoryId: z.number().int().nullable(),
  categoryOverride: z.boolean(),
  checked: z.boolean(),
  notes: z.string().nullable(),
});
export type ListItem = z.infer<typeof ListItem>;

export const ListSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isTemplate: z.boolean(),
  /** System templates are shared and read-only. */
  system: z.boolean(),
  archived: z.boolean(),
  itemCount: z.number().int(),
  checkedCount: z.number().int(),
  updatedAt: z.string(),
});
export type ListSummary = z.infer<typeof ListSummary>;

export const ListGroup = z.object({
  categoryId: z.number().int().nullable(),
  categoryName: z.string(),
  items: z.array(ListItem),
});
export type ListGroup = z.infer<typeof ListGroup>;

export const ListDetail = ListSummary.extend({ groups: z.array(ListGroup) });
export type ListDetail = z.infer<typeof ListDetail>;

export const ListResponse = z.object({ list: ListDetail });
export const ListsResponse = z.object({
  lists: z.array(ListSummary),
  nextCursor: z.string().nullable(),
});
export const TemplatesResponse = z.object({ templates: z.array(ListSummary) });

const Name = z.string().trim().min(1, 'Give the list a name').max(120);
const Description = z.string().trim().max(500).nullable();

export const CreateListRequest = z
  .object({ name: Name, description: Description.optional(), fromTemplateId: z.uuid().optional() })
  .strict();
export type CreateListRequest = z.infer<typeof CreateListRequest>;

export const UpdateListRequest = z
  .object({ name: Name, description: Description, archived: z.boolean() })
  .partial()
  .strict();
export type UpdateListRequest = z.infer<typeof UpdateListRequest>;

export const SaveAsTemplateRequest = z.object({ name: Name.optional() }).strict();

const Quantity = z.number().gt(0, 'Quantity must be more than 0').max(9999);
const Notes = z.string().trim().max(300).nullable();

export const AddItemRequest = z
  .object({
    rawText: z.string().trim().min(1, 'Type an item').max(200),
    productId: z.uuid().nullable().optional(),
    quantity: Quantity.optional(),
    unit: UnitCode.nullable().optional(),
    matchMode: MatchMode.optional(),
    brand: z.string().trim().min(1).max(80).nullable().optional(),
    storeItemId: z.uuid().nullable().optional(),
    notes: Notes.optional(),
  })
  .strict();
export type AddItemRequest = z.infer<typeof AddItemRequest>;

export const UpdateItemRequest = z
  .object({
    rawText: z.string().trim().min(1).max(200),
    productId: z.uuid().nullable(),
    quantity: Quantity,
    unit: UnitCode.nullable(),
    matchMode: MatchMode,
    brand: z.string().trim().min(1).max(80).nullable(),
    storeItemId: z.uuid().nullable(),
    categoryId: z.number().int().positive().nullable(),
    checked: z.boolean(),
    notes: Notes,
  })
  .partial()
  .strict();
export type UpdateItemRequest = z.infer<typeof UpdateItemRequest>;

export const ItemResponse = z.object({ item: ListItem });

export const ReorderRequest = z.object({ itemIds: z.array(z.uuid()).min(1).max(1000) }).strict();

// ───────────── import ─────────────
export const ImportPreviewRequest = z
  .object({
    format: z.enum(['text', 'csv']),
    /** Pasted text, or the CSV file's contents (read client-side). ≤ 1 MB, ≤ 500 lines. */
    content: z.string().min(1, 'Nothing to import').max(1_000_000),
  })
  .strict();
export type ImportPreviewRequest = z.infer<typeof ImportPreviewRequest>;

export const ImportCandidate = z.object({
  productId: z.uuid(),
  name: z.string(),
  score: z.number(),
});

export const ImportLineStatus = z.enum(['matched', 'ambiguous', 'unmatched']);

export const ImportPreviewLine = z.object({
  lineNo: z.number().int(),
  raw: z.string(),
  name: z.string(),
  quantity: z.number(),
  unit: UnitCode.nullable(),
  brand: z.string().nullable(),
  notes: z.string().nullable(),
  status: ImportLineStatus,
  /** Set only when status = matched. Ambiguous lines are never auto-matched. */
  productId: z.uuid().nullable(),
  candidates: z.array(ImportCandidate),
});
export type ImportPreviewLine = z.infer<typeof ImportPreviewLine>;

export const ImportPreviewResponse = z.object({
  format: z.enum(['text', 'csv']),
  lines: z.array(ImportPreviewLine),
  errors: z.array(z.object({ lineNo: z.number().int(), message: z.string() })),
});
export type ImportPreviewResponse = z.infer<typeof ImportPreviewResponse>;

export const ImportCommitRequest = z
  .object({
    listId: z.uuid().optional(),
    newListName: Name.optional(),
    lines: z
      .array(
        z
          .object({
            raw: z.string().trim().min(1).max(200),
            productId: z.uuid().nullable(),
            quantity: Quantity,
            unit: UnitCode.nullable(),
            brand: z.string().trim().min(1).max(80).nullable().optional(),
            notes: Notes.optional(),
          })
          .strict(),
      )
      .min(1, 'Nothing to import')
      .max(500),
  })
  .strict()
  .refine((v) => (v.listId === undefined) !== (v.newListName === undefined), {
    message: 'Provide either listId or newListName',
    path: ['listId'],
  });
export type ImportCommitRequest = z.infer<typeof ImportCommitRequest>;
