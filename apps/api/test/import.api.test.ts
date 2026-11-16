import { products } from '@sgs/db';
import { ErrorResponse, ImportPreviewResponse, ListResponse } from '@sgs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, CSRF, setupCatalogDb, signUp, type TestDb } from './helpers.js';

let db: TestDb;
let app: ReturnType<typeof buildApp>;
let cookie: string;
let slugById: Map<string, string>;
beforeAll(async () => {
  db = await setupCatalogDb('api_import');
  app = buildApp(db);
  cookie = (await signUp(app, 'importer')).cookie;
  slugById = new Map(
    (await db.db.select({ id: products.id, slug: products.slug }).from(products)).map((p) => [
      p.id,
      p.slug,
    ]),
  );
});
afterAll(async () => {
  await db.close();
});

const preview = async (format: 'text' | 'csv', content: string, status = 200) => {
  const res = await request(app)
    .post('/api/v1/imports/preview')
    .set(CSRF)
    .set('Cookie', cookie)
    .send({ format, content })
    .expect(status);
  return res;
};

/** The family-week fixture as a person would actually type it, with the product each line means. */
const FAMILY_TEXT: readonly [string, string][] = [
  ['2 gal whole milk', 'whole-milk'],
  ['18 eggs', 'large-eggs'],
  ['3 lb bananas', 'bananas'],
  ['3 lb gala apples', 'gala-apples'],
  ['strawberries', 'strawberries'],
  ['4 avocados', 'avocados'],
  ['2 lb roma tomatoes', 'roma-tomatoes'],
  ['yellow onions', 'yellow-onions'],
  ['5 lb russet potatoes', 'russet-potatoes'],
  ['romaine hearts', 'romaine'],
  ['3 lb ground beef', 'ground-beef-80'],
  ['4 lb chicken breasts', 'chicken-breast'],
  ['bacon', 'bacon'],
  ['butter', 'salted-butter'],
  ['16 oz shredded cheddar', 'shredded-cheddar'],
  ['2 loaves white bread', 'white-bread'],
  ['2 packs flour tortillas', 'flour-tortillas'],
  ['peanut butter', 'peanut-butter'],
  ['2 cans diced tomatoes', 'diced-tomatoes'],
  ['salsa', 'salsa'],
  ['3 boxes mac and cheese', 'mac-and-cheese'],
  ['ketchup', 'ketchup'],
  ['spaghetti x2', 'spaghetti'],
  ['2 jars pasta sauce', 'pasta-sauce'],
  ['2 lb rice', 'white-rice'],
  ['cheerios', 'toasted-oats-cereal'],
  ['coffee', 'ground-coffee'],
  ['orange juice', 'orange-juice'],
  ['bottled water', 'bottled-water'],
  ['coke', 'cola'],
  ['tortilla chips', 'tortilla-chips'],
  ['granola bars', 'granola-bars'],
  ['toilet paper', 'toilet-paper'],
  ['2 bags frozen mixed vegetables', 'frozen-mixed-veg'],
  ['ice cream', 'vanilla-ice-cream'],
];

describe('import preview', () => {
  it('family-week fixture: ≥90% matched automatically and zero wrong matches', async () => {
    expect(FAMILY_TEXT).toHaveLength(35);
    const body = ImportPreviewResponse.parse(
      (await preview('text', FAMILY_TEXT.map(([t]) => t).join('\n'))).body,
    );
    expect(body.errors).toEqual([]);
    expect(body.lines).toHaveLength(35);
    const wrong: string[] = [];
    let matched = 0;
    body.lines.forEach((l, i) => {
      if (l.status !== 'matched') return;
      matched++;
      const expected = FAMILY_TEXT[i]?.[1];
      if (slugById.get(l.productId ?? '') !== expected)
        wrong.push(
          `${l.raw} → ${slugById.get(l.productId ?? '') ?? '?'} (expected ${expected ?? '?'})`,
        );
    });
    const notMatched = body.lines
      .filter((l) => l.status !== 'matched')
      .map((l) => `${l.raw} (${l.status})`);
    console.info(
      `family-week import: ${String(matched)}/35 matched; not matched: ${notMatched.join(', ') || 'none'}`,
    );
    expect(wrong).toEqual([]);
    expect(matched / 35).toBeGreaterThanOrEqual(0.9);
    const milk = body.lines[0];
    expect(milk).toMatchObject({ quantity: 2, unit: 'gal', status: 'matched' });
  });

  it('ambiguous lines carry candidates but never a productId', async () => {
    const body = ImportPreviewResponse.parse((await preview('text', 'cheese\nzzz qqq')).body);
    const [cheese, junk] = body.lines;
    expect(cheese).toMatchObject({ status: 'ambiguous', productId: null });
    expect(cheese?.candidates.length).toBeGreaterThan(1);
    expect(junk).toMatchObject({ status: 'unmatched', productId: null, candidates: [] });
  });

  it('CSV: header variants, quoted commas, BOM, and bad rows with line numbers', async () => {
    const csv =
      '\uFEFFProduct,Qty,Unit,Notes\n"Beans, black",2,cans,\nWhole milk,two,gal,\n2% milk,1,gal,"for coffee, mostly"\n';
    const body = ImportPreviewResponse.parse((await preview('csv', csv)).body);
    expect(body.errors).toEqual([{ lineNo: 3, message: 'Quantity "two" is not a number' }]);
    expect(
      body.lines.map((l) => [
        l.lineNo,
        slugById.get(l.productId ?? ''),
        l.quantity,
        l.unit,
        l.notes,
      ]),
    ).toEqual([
      [2, 'black-beans', 2, null, null],
      [4, '2-percent-milk', 1, 'gal', 'for coffee, mostly'],
    ]);
  });

  it('rejects more than 500 lines (422), an unclosed quote (422), and bodies over 1 MB (413)', async () => {
    expect(
      ErrorResponse.parse((await preview('text', 'milk\n'.repeat(501), 422)).body).error.message,
    ).toMatch(/500 lines/);
    const bad = ErrorResponse.parse((await preview('csv', 'item\n"milk\n', 422)).body).error;
    expect(bad.message).toMatch(/Unclosed quote/);
    const big = await request(app)
      .post('/api/v1/imports/preview')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ format: 'text', content: 'x'.repeat(1_100_000) })
      .expect(413);
    expect(ErrorResponse.parse(big.body).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('requires sign-in', async () => {
    await request(app)
      .post('/api/v1/imports/preview')
      .set(CSRF)
      .send({ format: 'text', content: 'milk' })
      .expect(401);
  });
});

describe('import commit', () => {
  it('commits exactly the reviewed lines into a new list; unresolved lines stay free text', async () => {
    const body = ImportPreviewResponse.parse(
      (await preview('text', '2 lb ground beef\ncheese\nmilk x2')).body,
    );
    const lines = body.lines.map((l) => ({
      raw: l.raw,
      productId: l.productId,
      quantity: l.quantity,
      unit: l.unit,
    }));
    const res = await request(app)
      .post('/api/v1/imports/commit')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ newListName: 'Imported', lines })
      .expect(201);
    const list = ListResponse.parse(res.body).list;
    const items = list.groups.flatMap((g) => g.items).sort((a, b) => a.position - b.position);
    expect(list).toMatchObject({ name: 'Imported', itemCount: 3 });
    expect(items.map((i) => [i.rawText, i.product?.slug ?? null, i.quantity, i.unit])).toEqual([
      ['2 lb ground beef', 'ground-beef-80', 2, 'lb'],
      ['cheese', null, 1, null],
      ['milk x2', 'whole-milk', 2, null],
    ]);
  });

  it('appends to an existing list after its items, and validates product ids', async () => {
    const created = ListResponse.parse(
      (
        await request(app)
          .post('/api/v1/lists')
          .set(CSRF)
          .set('Cookie', cookie)
          .send({ name: 'Mine' })
      ).body,
    ).list;
    await request(app)
      .post(`/api/v1/lists/${created.id}/items`)
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ rawText: 'eggs' })
      .expect(201);
    const res = await request(app)
      .post('/api/v1/imports/commit')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({
        listId: created.id,
        lines: [{ raw: 'paper plates', productId: null, quantity: 1, unit: null }],
      })
      .expect(201);
    const items = ListResponse.parse(res.body).list.groups.flatMap((g) => g.items);
    expect(items.map((i) => [i.rawText, i.position]).sort()).toEqual([
      ['eggs', 0],
      ['paper plates', 1],
    ]);
    await request(app)
      .post('/api/v1/imports/commit')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({
        listId: created.id,
        lines: [
          { raw: 'x', productId: '11111111-1111-4111-8111-111111111111', quantity: 1, unit: null },
        ],
      })
      .expect(422);
  });
});
