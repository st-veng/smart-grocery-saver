import {
  type AlertResponse,
  type AlertsResponse,
  CreateAlertRequest,
  HistoryRange,
  type HistoryResponse,
  type NotificationsResponse,
  SimAdvanceRequest,
  type SimAdvanceResponse,
  type StoreItemHistoryResponse,
  UpdateAlertRequest,
  AddItemRequest,
  CreateListRequest,
  ImportCommitRequest,
  ImportPreviewRequest,
  ReorderRequest,
  SaveAsTemplateRequest,
  UpdateItemRequest,
  UpdateListRequest,
  type CategoriesResponse,
  type ComparisonResponse,
  type ProductOffersResponse,
  type ImportPreviewResponse,
  type ItemResponse,
  type ListResponse,
  type ListsResponse,
  type ProductResponse,
  type ProductsResponse,
  type TemplatesResponse,
} from '@sgs/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { auth, requireAuth } from '../auth/middleware.js';
import { addDays, isIsoDate, todayIn } from '@sgs/core';
import { advanceTo, marketDates } from '@sgs/pricing';
import {
  deleteAlert,
  listAlerts,
  listNotifications,
  markRead,
  productHistory,
  storeItemHistory,
  updateAlert,
  upsertAlert,
} from '../services/history.js';
import { getProduct, listCategories, searchProducts } from '../services/catalog.js';
import { compareListForUser, productOffersForUser } from '../services/compare.js';
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
import { idParam, Paging, parse } from '../validate.js';

type Out<T extends z.ZodType> = z.infer<T>;

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
  const guard = requireAuth(db, deps.tokens);
  r.use(['/lists', '/templates', '/imports', '/alerts', '/notifications'], guard);

  const CompareQuery = z.object({
    asOf: z.string().refine(isIsoDate, 'asOf must be YYYY-MM-DD').optional(),
    stores: z
      .string()
      .regex(/^\d+(,\d+)*$/, 'stores must be comma-separated store ids')
      .transform((v) => v.split(',').map(Number))
      .optional(),
  });
  /** Prices are calendar dates in America/Chicago (SPEC A-7). */
  const today = () => todayIn('America/Chicago', deps.clock());

  r.get('/lists/:id/comparison', async (req, res) => {
    const q = parse(CompareQuery, req.query);
    const body: ComparisonResponse = await compareListForUser(
      db,
      auth(res).userId,
      idParam(req, 'id'),
      {
        asOf: q.asOf ?? today(),
        storeIds: q.stores,
        radiusMiles: deps.config.preselectRadiusMiles,
        metro: deps.metro,
      },
    );
    res.json(body);
  });

  r.get('/products/:id/offers', guard, async (req, res) => {
    const q = parse(CompareQuery.pick({ asOf: true }), req.query);
    const body: ProductOffersResponse = await productOffersForUser(
      db,
      auth(res).userId,
      idParam(req, 'id'),
      {
        asOf: q.asOf ?? today(),
        radiusMiles: deps.config.preselectRadiusMiles,
        metro: deps.metro,
      },
    );
    res.json(body);
  });
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

  // ───────────── history, alerts, notifications (Phase 5) ─────────────
  const HistoryQuery = z.object({
    range: HistoryRange.default('90d'),
    asOf: z.string().refine(isIsoDate, 'asOf must be YYYY-MM-DD').optional(),
  });
  const ctx = { radiusMiles: deps.config.preselectRadiusMiles, metro: deps.metro };

  r.get('/products/:id/history', guard, async (req, res) => {
    const q = parse(HistoryQuery, req.query);
    const body: z.infer<typeof HistoryResponse> = await productHistory(
      db,
      auth(res).userId,
      idParam(req, 'id'),
      q.range,
      q.asOf ?? today(),
      ctx,
    );
    res.json(body);
  });

  r.get('/store-items/:id/history', guard, async (req, res) => {
    const q = parse(HistoryQuery, req.query);
    const body: z.infer<typeof StoreItemHistoryResponse> = await storeItemHistory(
      db,
      auth(res).userId,
      idParam(req, 'id'),
      q.range,
      q.asOf ?? today(),
      ctx,
    );
    res.json(body);
  });

  r.get('/alerts', async (_req, res) => {
    const body: z.infer<typeof AlertsResponse> = { alerts: await listAlerts(db, auth(res).userId) };
    res.json(body);
  });

  r.post('/alerts', async (req, res) => {
    const alert = await upsertAlert(
      db,
      auth(res).userId,
      parse(CreateAlertRequest, req.body),
      now(),
    );
    const body: z.infer<typeof AlertResponse> = { alert };
    res.status(201).json(body);
  });

  r.patch('/alerts/:id', async (req, res) => {
    const alert = await updateAlert(
      db,
      auth(res).userId,
      idParam(req, 'id'),
      parse(UpdateAlertRequest, req.body),
    );
    const body: z.infer<typeof AlertResponse> = { alert };
    res.json(body);
  });

  r.delete('/alerts/:id', async (req, res) => {
    await deleteAlert(db, auth(res).userId, idParam(req, 'id'));
    res.status(204).end();
  });

  r.get('/notifications', async (req, res) => {
    const q = parse(z.object({ unread: z.enum(['true', 'false']).default('false') }), req.query);
    const body: z.infer<typeof NotificationsResponse> = await listNotifications(
      db,
      auth(res).userId,
      q.unread === 'true',
    );
    res.json(body);
  });

  r.post('/notifications/read-all', async (_req, res) => {
    await markRead(db, auth(res).userId, 'all', now());
    res.status(204).end();
  });

  r.post('/notifications/:id/read', async (req, res) => {
    await markRead(db, auth(res).userId, idParam(req, 'id'), now());
    res.status(204).end();
  });

  return r;
}

/**
 * Test-only hooks (e2e). Mounted only when ENABLE_TEST_HOOKS=true, which config refuses in production.
 * POST /api/v1/test/sim/advance {to?: date, days?: n} — idempotent market-date advance + alert run.
 */
export function testHooksRouter(deps: AppDeps): Router {
  const r = Router();
  r.post('/test/sim/advance', async (req, res) => {
    const input = parse(SimAdvanceRequest, req.body ?? {});
    const { current } = await marketDates(deps.db);
    if (!current) throw new AppError('SERVICE_UNAVAILABLE', 503, 'No seeded market data');
    if (input.to !== undefined && !isIsoDate(input.to)) {
      throw new AppError('VALIDATION_FAILED', 400, 'to must be YYYY-MM-DD');
    }
    const target = input.to ?? addDays(current, input.days ?? 1);
    const result = await advanceTo(deps.db, deps.provider, target, { now: deps.clock });
    const body: z.infer<typeof SimAdvanceResponse> = result;
    res.json(body);
  });
  return r;
}
