import {
  AddItemRequest,
  CreateListRequest,
  ImportCommitRequest,
  ImportPreviewRequest,
  ReorderRequest,
  SaveAsTemplateRequest,
  UpdateItemRequest,
  UpdateListRequest,
  type CategoriesResponse,
  type ImportPreviewResponse,
  type ItemResponse,
  type ListResponse,
  type ListsResponse,
  type ProductResponse,
  type ProductsResponse,
  type TemplatesResponse,
} from '@sgs/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { auth, requireAuth } from '../auth/middleware.js';
import { getProduct, listCategories, searchProducts } from '../services/catalog.js';
import { commitImport, previewImport } from '../services/imports.js';
import {
  addItem,
  copyList,
  createList,
  deleteItem,
  deleteList,
  getTemplate,
  listDetail,
  listLists,
  listTemplates,
  ownedList,
  reorderItems,
  updateItem,
  updateList,
} from '../services/lists.js';
import { AppError } from '../errors.js';
import { parse } from '../validate.js';

type Out<T extends z.ZodType> = z.infer<T>;

const Uuid = z.uuid();
const Paging = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.coerce.number().int().min(0).default(0),
});

/** Path ids that are not UUIDs can't exist: 404 (not 400) so probing reveals nothing. */
function idParam(req: Request, name: string): string {
  const v = req.params[name];
  const r = Uuid.safeParse(v);
  if (!r.success) throw new AppError('NOT_FOUND', 404, 'Not found');
  return r.data;
}

export function catalogRouter(deps: AppDeps): Router {
  const r = Router();
  r.get('/categories', async (_req, res) => {
    const body: Out<typeof CategoriesResponse> = { categories: await listCategories(deps.db) };
    res.json(body);
  });
  r.get('/products', async (req, res) => {
    const q = parse(
      Paging.extend({
        q: z.string().max(100).optional(),
        categoryId: z.coerce.number().int().positive().optional(),
      }),
      req.query,
    );
    const body: Out<typeof ProductsResponse> = await searchProducts(deps.db, q);
    res.json(body);
  });
  r.get('/products/:id', async (req, res) => {
    const body: Out<typeof ProductResponse> = await getProduct(deps.db, idParam(req, 'id'));
    res.json(body);
  });
  return r;
}

export function listsRouter(deps: AppDeps): Router {
  const r = Router();
  const { db } = deps;
  r.use(['/lists', '/templates', '/imports'], requireAuth(db, deps.tokens));
  const now = () => deps.clock();

  const sendList = async (
    res: Parameters<Parameters<Router['get']>[1]>[1],
    userId: string,
    id: string,
    status = 200,
  ) => {
    const body: Out<typeof ListResponse> = {
      list: await listDetail(db, await ownedList(db, userId, id)),
    };
    res.status(status).json(body);
  };

  r.get('/lists', async (req, res) => {
    const q = parse(
      Paging.extend({ archived: z.enum(['true', 'false']).default('false') }),
      req.query,
    );
    const body: Out<typeof ListsResponse> = await listLists(db, auth(res).userId, {
      archived: q.archived === 'true',
      limit: q.limit,
      cursor: q.cursor,
    });
    res.json(body);
  });

  r.post('/lists', async (req, res) => {
    const row = await createList(db, auth(res).userId, parse(CreateListRequest, req.body), now());
    await sendList(res, auth(res).userId, row.id, 201);
  });

  r.get('/lists/:id', async (req, res) => {
    await sendList(res, auth(res).userId, idParam(req, 'id'));
  });

  r.patch('/lists/:id', async (req, res) => {
    const id = idParam(req, 'id');
    await updateList(db, auth(res).userId, id, parse(UpdateListRequest, req.body), now());
    await sendList(res, auth(res).userId, id);
  });

  r.delete('/lists/:id', async (req, res) => {
    await deleteList(db, auth(res).userId, idParam(req, 'id'));
    res.status(204).end();
  });

  r.post('/lists/:id/duplicate', async (req, res) => {
    const row = await copyList(
      db,
      auth(res).userId,
      idParam(req, 'id'),
      { asTemplate: false },
      now(),
    );
    await sendList(res, auth(res).userId, row.id, 201);
  });

  r.post('/lists/:id/save-as-template', async (req, res) => {
    const input = parse(SaveAsTemplateRequest, req.body ?? {});
    const row = await copyList(
      db,
      auth(res).userId,
      idParam(req, 'id'),
      { asTemplate: true, name: input.name },
      now(),
    );
    await sendList(res, auth(res).userId, row.id, 201);
  });

  r.post('/lists/:id/items', async (req, res) => {
    const item = await addItem(
      db,
      auth(res).userId,
      idParam(req, 'id'),
      parse(AddItemRequest, req.body),
      now(),
    );
    const body: Out<typeof ItemResponse> = { item };
    res.status(201).json(body);
  });

  r.patch('/lists/:id/items/:itemId', async (req, res) => {
    const item = await updateItem(
      db,
      auth(res).userId,
      idParam(req, 'id'),
      idParam(req, 'itemId'),
      parse(UpdateItemRequest, req.body),
      now(),
    );
    const body: Out<typeof ItemResponse> = { item };
    res.json(body);
  });

  r.delete('/lists/:id/items/:itemId', async (req, res) => {
    await deleteItem(db, auth(res).userId, idParam(req, 'id'), idParam(req, 'itemId'), now());
    res.status(204).end();
  });

  r.put('/lists/:id/items/order', async (req, res) => {
    const id = idParam(req, 'id');
    await reorderItems(db, auth(res).userId, id, parse(ReorderRequest, req.body).itemIds, now());
    await sendList(res, auth(res).userId, id);
  });

  r.get('/templates', async (_req, res) => {
    const body: Out<typeof TemplatesResponse> = {
      templates: await listTemplates(db, auth(res).userId),
    };
    res.json(body);
  });

  r.get('/templates/:id', async (req, res) => {
    const body: Out<typeof ListResponse> = {
      list: await getTemplate(db, auth(res).userId, idParam(req, 'id')),
    };
    res.json(body);
  });

  r.post('/imports/preview', async (req, res) => {
    const body: ImportPreviewResponse = await previewImport(
      db,
      parse(ImportPreviewRequest, req.body),
    );
    res.json(body);
  });

  r.post('/imports/commit', async (req, res) => {
    const listId = await commitImport(
      db,
      auth(res).userId,
      parse(ImportCommitRequest, req.body),
      now(),
    );
    await sendList(res, auth(res).userId, listId, 201);
  });

  return r;
}
