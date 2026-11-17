import {
  ErrorResponse,
  ItemResponse,
  ListResponse,
  ListsResponse,
  ProductsResponse,
  TemplatesResponse,
  type ListDetail,
} from '@sgs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, CSRF, setupCatalogDb, signUp, type TestDb } from './helpers.js';

let db: TestDb;
let app: ReturnType<typeof buildApp>;
beforeAll(async () => {
  db = await setupCatalogDb('api_lists');
  app = buildApp(db);
});
afterAll(async () => {
  await db.close();
});

const items = (l: ListDetail) => l.groups.flatMap((g) => g.items);

async function product(q: string) {
  const res = await request(app)
    .get(`/api/v1/products?q=${encodeURIComponent(q)}&limit=5`)
    .expect(200);
  const p = ProductsResponse.parse(res.body).products[0];
  if (!p) throw new Error(`no product for ${q}`);
  return p;
}

async function newList(cookie: string, name = 'Groceries') {
  const res = await request(app)
    .post('/api/v1/lists')
    .set(CSRF)
    .set('Cookie', cookie)
    .send({ name })
    .expect(201);
  return ListResponse.parse(res.body).list;
}

async function add(cookie: string, listId: string, body: object, status = 201) {
  const res = await request(app)
    .post(`/api/v1/lists/${listId}/items`)
    .set(CSRF)
    .set('Cookie', cookie)
    .send(body)
    .expect(status);
  return res;
}

async function getList(cookie: string, id: string) {
  return ListResponse.parse(
    (await request(app).get(`/api/v1/lists/${id}`).set('Cookie', cookie).expect(200)).body,
  ).list;
}

describe('catalog', () => {
  it('searches products by name and alias with typeahead-friendly prefixes', async () => {
    const names = async (q: string) =>
      ProductsResponse.parse(
        (await request(app).get(`/api/v1/products?q=${q}`).expect(200)).body,
      ).products.map((p) => p.slug);
    expect((await names('whole mi'))[0]).toBe('whole-milk');
    expect(await names('oj')).toContain('orange-juice');
    expect((await names('tortil')).slice(0, 3)).toEqual(
      expect.arrayContaining(['flour-tortillas', 'corn-tortillas']),
    );
    expect(await names('zzzzqqq')).toEqual([]);
    // Exact name/alias beats a longer name that merely starts with the query.
    expect((await names('honey'))[0]).toBe('honey');
    expect((await names('milk'))[0]).toBe('whole-milk');
    expect((await names('pepper'))[0]).toBe('black-pepper');
  });

  it('pages through products and filters by category', async () => {
    const first = ProductsResponse.parse(
      (await request(app).get('/api/v1/products?limit=10').expect(200)).body,
    );
    expect(first.products).toHaveLength(10);
    expect(first.nextCursor).toBe('10');
    const second = ProductsResponse.parse(
      (await request(app).get('/api/v1/products?limit=10&cursor=10').expect(200)).body,
    );
    expect(second.products[0]?.id).not.toBe(first.products[0]?.id);
    const cats = (await request(app).get('/api/v1/categories').expect(200)).body as {
      categories: { id: number; slug: string }[];
    };
    const eggs = cats.categories.find((c) => c.slug === 'eggs');
    const inEggs = ProductsResponse.parse(
      (await request(app).get(`/api/v1/products?categoryId=${String(eggs?.id)}`)).body,
    );
    expect(inEggs.products.every((p) => p.categoryId === eggs?.id)).toBe(true);
    await request(app).get('/api/v1/products/not-a-uuid').expect(404);
  });
});

describe('lists CRUD', () => {
  it('creates, renames, archives, lists and deletes', async () => {
    const { cookie } = await signUp(app, 'crud');
    const list = await newList(cookie, 'Weekend');
    expect(list).toMatchObject({
      name: 'Weekend',
      itemCount: 0,
      isTemplate: false,
      system: false,
      archived: false,
      groups: [],
    });
    const renamed = ListResponse.parse(
      (
        await request(app)
          .patch(`/api/v1/lists/${list.id}`)
          .set(CSRF)
          .set('Cookie', cookie)
          .send({ name: 'Weekend BBQ' })
          .expect(200)
      ).body,
    ).list;
    expect(renamed.name).toBe('Weekend BBQ');
    await request(app)
      .patch(`/api/v1/lists/${list.id}`)
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ archived: true })
      .expect(200);
    const active = ListsResponse.parse(
      (await request(app).get('/api/v1/lists').set('Cookie', cookie)).body,
    ).lists;
    const archived = ListsResponse.parse(
      (await request(app).get('/api/v1/lists?archived=true').set('Cookie', cookie)).body,
    ).lists;
    expect(active.map((l) => l.id)).not.toContain(list.id);
    expect(archived.map((l) => l.id)).toContain(list.id);
    await request(app)
      .delete(`/api/v1/lists/${list.id}`)
      .set(CSRF)
      .set('Cookie', cookie)
      .expect(204);
    await request(app).get(`/api/v1/lists/${list.id}`).set('Cookie', cookie).expect(404);
  });

  it('validates names', async () => {
    const { cookie } = await signUp(app, 'v');
    await request(app)
      .post('/api/v1/lists')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ name: '   ' })
      .expect(400);
    await request(app)
      .post('/api/v1/lists')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ name: 'x'.repeat(121) })
      .expect(400);
  });
});

describe('items', () => {
  it('adds by product, groups by category in aisle order, and counts checked items', async () => {
    const { cookie } = await signUp(app, 'items');
    const list = await newList(cookie);
    const milk = await product('whole milk');
    const bananas = await product('bananas');
    await add(cookie, list.id, {
      rawText: 'Whole Milk',
      productId: milk.id,
      quantity: 2,
      unit: 'gal',
    });
    const b = ItemResponse.parse(
      (
        await add(cookie, list.id, {
          rawText: 'Bananas',
          productId: bananas.id,
          quantity: 3,
          unit: 'lb',
        })
      ).body,
    ).item;
    await add(cookie, list.id, { rawText: 'birthday candles', productId: null });
    await request(app)
      .patch(`/api/v1/lists/${list.id}/items/${b.id}`)
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ checked: true })
      .expect(200);
    const l = await getList(cookie, list.id);
    expect(l.groups.map((g) => g.categoryName)).toEqual(['Produce', 'Dairy', 'Other']);
    expect(l).toMatchObject({ itemCount: 3, checkedCount: 1 });
    expect(items(l).find((i) => i.rawText === 'birthday candles')).toMatchObject({
      product: null,
      unit: null,
      categoryId: null,
    });
  });

  it('auto-matches confident free text with its quantity, and leaves vague text unmatched', async () => {
    const { cookie } = await signUp(app, 'free');
    const list = await newList(cookie);
    const beef = ItemResponse.parse(
      (await add(cookie, list.id, { rawText: '2 lb ground beef' })).body,
    ).item;
    expect(beef).toMatchObject({ quantity: 2, unit: 'lb' });
    expect(beef.product?.slug).toBe('ground-beef-80');
    const oj = ItemResponse.parse(
      (await add(cookie, list.id, { rawText: '64 oz orange juice' })).body,
    ).item;
    expect(oj).toMatchObject({ quantity: 64, unit: 'fl_oz' }); // bare oz on a liquid → fl oz
    const vague = ItemResponse.parse((await add(cookie, list.id, { rawText: 'cheese' })).body).item;
    expect(vague.product).toBeNull();
    const explicitText = ItemResponse.parse(
      (await add(cookie, list.id, { rawText: 'milk', productId: null })).body,
    ).item;
    expect(explicitText.product).toBeNull();
  });

  it('rejects units that do not fit the product and inconsistent brand settings', async () => {
    const { cookie } = await signUp(app, 'units');
    const list = await newList(cookie);
    const milk = await product('whole milk');
    const res = await add(
      cookie,
      list.id,
      { rawText: 'milk', productId: milk.id, unit: 'lb' },
      422,
    );
    expect(ErrorResponse.parse(res.body).error.details).toEqual([
      expect.objectContaining({ path: ['unit'] }),
    ]);
    await add(cookie, list.id, { rawText: 'milk', productId: milk.id, matchMode: 'brand' }, 422);
    const ok = ItemResponse.parse(
      (await add(cookie, list.id, { rawText: 'milk', productId: milk.id, brand: 'Borden' })).body,
    ).item;
    expect(ok).toMatchObject({ matchMode: 'brand', brand: 'Borden' });
  });

  it('changing the product resets an incompatible unit and brand', async () => {
    const { cookie } = await signUp(app, 'swap');
    const list = await newList(cookie);
    const milk = await product('whole milk');
    const eggs = await product('large eggs');
    const it0 = ItemResponse.parse(
      (
        await add(cookie, list.id, {
          rawText: 'milk',
          productId: milk.id,
          quantity: 1,
          unit: 'gal',
          brand: 'Borden',
        })
      ).body,
    ).item;
    const res = await request(app)
      .patch(`/api/v1/lists/${list.id}/items/${it0.id}`)
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ productId: eggs.id, quantity: 12 })
      .expect(200);
    expect(ItemResponse.parse(res.body).item).toMatchObject({
      unit: null,
      brand: null,
      matchMode: 'any',
      quantity: 12,
    });
  });

  it('persists a new order; rejects an order that is not exactly the list’s items', async () => {
    const { cookie } = await signUp(app, 'order');
    const list = await newList(cookie);
    const ids: string[] = [];
    for (const t of ['milk', 'eggs', 'bread', 'bananas']) {
      ids.push(ItemResponse.parse((await add(cookie, list.id, { rawText: t })).body).item.id);
    }
    const order = [ids[3], ids[0], ids[2], ids[1]] as string[];
    await request(app)
      .put(`/api/v1/lists/${list.id}/items/order`)
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ itemIds: order })
      .expect(200);
    const after = items(await getList(cookie, list.id))
      .sort((a, b) => a.position - b.position)
      .map((i) => i.id);
    expect(after).toEqual(order);
    await request(app)
      .put(`/api/v1/lists/${list.id}/items/order`)
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ itemIds: order.slice(1) })
      .expect(422);
    await request(app)
      .put(`/api/v1/lists/${list.id}/items/order`)
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ itemIds: [...order.slice(1), order[1]] })
      .expect(422);
  });

  it('deletes items', async () => {
    const { cookie } = await signUp(app, 'del');
    const list = await newList(cookie);
    const i = ItemResponse.parse((await add(cookie, list.id, { rawText: 'milk' })).body).item;
    await request(app)
      .delete(`/api/v1/lists/${list.id}/items/${i.id}`)
      .set(CSRF)
      .set('Cookie', cookie)
      .expect(204);
    expect((await getList(cookie, list.id)).itemCount).toBe(0);
  });
});

describe('ownership isolation (other users get 404, never 403)', () => {
  it('blocks every list and item operation on someone else’s list', async () => {
    const a = await signUp(app, 'owner');
    const b = await signUp(app, 'intruder');
    const list = await newList(a.cookie, 'Private');
    const item = ItemResponse.parse((await add(a.cookie, list.id, { rawText: 'milk' })).body).item;
    const asB = (r: request.Test) => r.set(CSRF).set('Cookie', b.cookie);
    const base = `/api/v1/lists/${list.id}`;
    const attempts: [string, request.Test][] = [
      ['GET list', asB(request(app).get(base))],
      ['PATCH list', asB(request(app).patch(base).send({ name: 'mine now' }))],
      ['DELETE list', asB(request(app).delete(base))],
      ['duplicate', asB(request(app).post(`${base}/duplicate`))],
      ['save-as-template', asB(request(app).post(`${base}/save-as-template`).send({}))],
      ['add item', asB(request(app).post(`${base}/items`).send({ rawText: 'eggs' }))],
      ['PATCH item', asB(request(app).patch(`${base}/items/${item.id}`).send({ checked: true }))],
      ['DELETE item', asB(request(app).delete(`${base}/items/${item.id}`))],
      [
        'reorder',
        asB(
          request(app)
            .put(`${base}/items/order`)
            .send({ itemIds: [item.id] }),
        ),
      ],
      [
        'import commit',
        asB(
          request(app)
            .post('/api/v1/imports/commit')
            .send({
              listId: list.id,
              lines: [{ raw: 'x', productId: null, quantity: 1, unit: null }],
            }),
        ),
      ],
    ];
    for (const [label, r] of attempts) {
      expect((await r).status, label).toBe(404);
    }
    const bLists = ListsResponse.parse(
      (await request(app).get('/api/v1/lists').set('Cookie', b.cookie)).body,
    ).lists;
    expect(bLists.map((l) => l.id)).not.toContain(list.id);
    // A's list is untouched.
    expect(await getList(a.cookie, list.id)).toMatchObject({
      name: 'Private',
      itemCount: 1,
      checkedCount: 0,
    });
  });

  it('an item id from another list is 404 even for the owner', async () => {
    const a = await signUp(app, 'mix');
    const l1 = await newList(a.cookie, 'one');
    const l2 = await newList(a.cookie, 'two');
    const i = ItemResponse.parse((await add(a.cookie, l1.id, { rawText: 'milk' })).body).item;
    await request(app)
      .patch(`/api/v1/lists/${l2.id}/items/${i.id}`)
      .set(CSRF)
      .set('Cookie', a.cookie)
      .send({ checked: true })
      .expect(404);
  });

  it('non-UUID ids are 404', async () => {
    const a = await signUp(app, 'ids');
    await request(app).get('/api/v1/lists/123').set('Cookie', a.cookie).expect(404);
  });
});

describe('templates', () => {
  it('offers ≥5 read-only system templates to everyone', async () => {
    const { cookie } = await signUp(app, 'tpl');
    const t = TemplatesResponse.parse(
      (await request(app).get('/api/v1/templates').set('Cookie', cookie).expect(200)).body,
    ).templates;
    const system = t.filter((x) => x.system);
    expect(system.map((x) => x.name).sort()).toEqual([
      'Breakfast',
      'Holiday baking',
      'Kid lunches',
      'Taco night',
      'Weekly staples',
    ]);
    expect(system.every((x) => x.itemCount >= 8)).toBe(true);
    const id = system[0]?.id ?? '';
    await request(app).get(`/api/v1/templates/${id}`).set('Cookie', cookie).expect(200);
    await request(app)
      .patch(`/api/v1/lists/${id}`)
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ name: 'hacked' })
      .expect(404);
    await request(app).delete(`/api/v1/lists/${id}`).set(CSRF).set('Cookie', cookie).expect(404);
  });

  it('instantiating a template makes a deep copy — editing it leaves the template unchanged', async () => {
    const { cookie } = await signUp(app, 'deep');
    const t = TemplatesResponse.parse(
      (await request(app).get('/api/v1/templates').set('Cookie', cookie)).body,
    ).templates;
    const taco = t.find((x) => x.name === 'Taco night');
    const before = ListResponse.parse(
      (
        await request(app)
          .get(`/api/v1/templates/${taco?.id ?? ''}`)
          .set('Cookie', cookie)
      ).body,
    ).list;
    const created = ListResponse.parse(
      (
        await request(app)
          .post('/api/v1/lists')
          .set(CSRF)
          .set('Cookie', cookie)
          .send({ name: 'Taco Tuesday', fromTemplateId: taco?.id })
          .expect(201)
      ).body,
    ).list;
    expect(created.itemCount).toBe(before.itemCount);
    const first = items(created)[0];
    await request(app)
      .patch(`/api/v1/lists/${created.id}/items/${first?.id ?? ''}`)
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ quantity: 9, checked: true })
      .expect(200);
    await request(app)
      .delete(`/api/v1/lists/${created.id}/items/${items(created)[1]?.id ?? ''}`)
      .set(CSRF)
      .set('Cookie', cookie)
      .expect(204);
    const after = ListResponse.parse(
      (
        await request(app)
          .get(`/api/v1/templates/${taco?.id ?? ''}`)
          .set('Cookie', cookie)
      ).body,
    ).list;
    expect(after.groups).toEqual(before.groups);
    const templateIds = new Set(items(before).map((i) => i.id));
    expect(items(created).filter((i) => templateIds.has(i.id))).toEqual([]);
  });

  it('saves a list as a private template and duplicates lists', async () => {
    const a = await signUp(app, 'save');
    const b = await signUp(app, 'other');
    const list = await newList(a.cookie, 'Party');
    await add(a.cookie, list.id, { rawText: '2 lb ground beef' });
    const tpl = ListResponse.parse(
      (
        await request(app)
          .post(`/api/v1/lists/${list.id}/save-as-template`)
          .set(CSRF)
          .set('Cookie', a.cookie)
          .send({ name: 'Party pack' })
          .expect(201)
      ).body,
    ).list;
    expect(tpl).toMatchObject({
      isTemplate: true,
      system: false,
      name: 'Party pack',
      itemCount: 1,
    });
    const mine = TemplatesResponse.parse(
      (await request(app).get('/api/v1/templates').set('Cookie', a.cookie)).body,
    ).templates;
    expect(mine.map((x) => x.id)).toContain(tpl.id);
    const theirs = TemplatesResponse.parse(
      (await request(app).get('/api/v1/templates').set('Cookie', b.cookie)).body,
    ).templates;
    expect(theirs.map((x) => x.id)).not.toContain(tpl.id);
    await request(app)
      .post('/api/v1/lists')
      .set(CSRF)
      .set('Cookie', b.cookie)
      .send({ name: 'x', fromTemplateId: tpl.id })
      .expect(404);
    const dup = ListResponse.parse(
      (
        await request(app)
          .post(`/api/v1/lists/${list.id}/duplicate`)
          .set(CSRF)
          .set('Cookie', a.cookie)
          .expect(201)
      ).body,
    ).list;
    expect(dup).toMatchObject({ name: 'Party (copy)', itemCount: 1, isTemplate: false });
  });
});
