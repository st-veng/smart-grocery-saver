import { runMigrations } from '@sgs/db';
import { createDb, type DbHandle } from '@sgs/db';
import { recreateDatabase, testDatabaseUrl } from '@sgs/db/testing';
import { DEMO_EMAIL, DEFAULT_DEMO_PASSWORD, seedDatabase } from '@sgs/pricing';
import {
  ComparisonResponse,
  ListsResponse,
  MyStoresResponse,
  ProductOffersResponse,
  ProductsResponse,
} from '@sgs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, cookieValues, CSRF, signUp, TestClock } from './helpers.js';

const ANCHOR = '2026-11-01';
let handle: DbHandle;
let app: ReturnType<typeof buildApp>;
let demo: string;
let familyWeekId: string;

beforeAll(async () => {
  const url = testDatabaseUrl('api_compare');
  await recreateDatabase(url);
  await runMigrations(url);
  await seedDatabase({ url, seed: '20261116', anchorDate: ANCHOR });
  handle = createDb(url);
  const clock = new TestClock();
  clock.now = new Date(`${ANCHOR}T18:00:00Z`);
  app = buildApp({ ...handle, url }, { clock });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .set(CSRF)
    .send({ email: DEMO_EMAIL, password: DEFAULT_DEMO_PASSWORD })
    .expect(200);
  demo = `sgs_at=${cookieValues(login.headers['set-cookie']).sgs_at ?? ''}`;
  const lists = ListsResponse.parse(
    (await request(app).get('/api/v1/lists').set('Cookie', demo)).body,
  ).lists;
  familyWeekId = lists.find((l) => l.name === 'Family week')?.id ?? '';
}, 120_000);
afterAll(async () => {
  await handle.close();
});

const compare = async (cookie: string, listId: string, query = '') =>
  ComparisonResponse.parse(
    (
      await request(app)
        .get(`/api/v1/lists/${listId}/comparison${query}`)
        .set('Cookie', cookie)
        .expect(200)
    ).body,
  );

describe('GET /lists/:id/comparison — family week (demo profile)', () => {
  it('matches the golden file (pinned seed + asOf)', async () => {
    const r = await compare(demo, familyWeekId, `?asOf=${ANCHOR}`);
    const slug = new Map(r.stores.map((s) => [s.id, s.slug]));
    const golden = {
      asOf: r.asOf,
      cheapest: slug.get(r.cheapestStoreId ?? -1) ?? null,
      baseline: { ...r.baseline, storeId: slug.get(r.baseline.storeId ?? -1) ?? null },
      savingsPct: r.savingsPct,
      savingsCents: r.savingsCents,
      excluded: r.excluded.map((e) => `${slug.get(e.storeId) ?? '?'}:${e.reason}`),
      totals: r.totals.map((t) => ({ ...t, storeId: slug.get(t.storeId) })),
      lines: r.lines.map((l) => ({
        product: l.product?.slug ?? null,
        need: l.need,
        cheapest: l.cheapestStoreIds.map((id) => slug.get(id)),
        stores: Object.fromEntries(
          l.stores.map((s) => [
            slug.get(s.storeId) ?? String(s.storeId),
            s.status === 'missing'
              ? 'missing'
              : `${s.title ?? ''} | ${String(s.packages ?? 'by wt')} | ${String(s.lineCents)}¢ | ${(s.unitPriceCents ?? 0).toFixed(2)}¢/${l.product?.displayUnit ?? ''}${s.onSale ? ` | ${s.promoLabel ?? 'sale'}` : ''}${s.approximate ? ' | ≈' : ''}`,
          ]),
        ),
      })),
    };
    await expect(JSON.stringify(golden, null, 2)).toMatchFileSnapshot(
      './__golden__/family-week-comparison.json',
    );
  });

  it('has the expected shape: 35 lines, Sam’s omitted (no membership), a complete cheapest store and savings vs Kroger', async () => {
    const r = await compare(demo, familyWeekId, `?asOf=${ANCHOR}`);
    const slug = new Map(r.stores.map((s) => [s.id, s.slug]));
    expect(r.lines).toHaveLength(35);
    expect(r.unpricedCount).toBe(0);
    expect(r.excluded.map((e) => [slug.get(e.storeId), e.reason])).toEqual(
      expect.arrayContaining([
        ['sams', 'no_membership'],
        ['traderjoes', 'disabled'],
      ]),
    );
    expect(r.totals.map((t) => slug.get(t.storeId))).not.toContain('sams');
    expect(slug.get(r.baseline.storeId ?? -1)).toBe('kroger');
    expect(r.baseline.source).toBe('user');
    const cheapest = r.totals.find((t) => t.storeId === r.cheapestStoreId);
    expect(cheapest?.complete).toBe(true);
    for (const t of r.totals.filter((x) => x.complete))
      expect(cheapest?.totalCents).toBeLessThanOrEqual(t.totalCents);
    expect(r.savingsPct).toBeGreaterThan(0);
    expect(r.savingsPct).toBeLessThan(25);
    const krogerTotal = r.totals.find((t) => slug.get(t.storeId) === 'kroger')?.totalCents ?? 0;
    expect(r.savingsCents).toBe(krogerTotal - (cheapest?.totalCents ?? 0));
  });

  it('p95 latency is under 300 ms over 50 runs', async () => {
    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t = performance.now();
      await request(app)
        .get(`/api/v1/lists/${familyWeekId}/comparison?asOf=${ANCHOR}`)
        .set('Cookie', demo)
        .expect(200);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1] ?? Infinity;
    console.info(
      `comparison latency: p50 ${(times[24] ?? 0).toFixed(0)} ms, p95 ${p95.toFixed(0)} ms`,
    );
    expect(p95).toBeLessThan(300);
  });

  it('only the selected stores are compared; the rest stay available to toggle back on', async () => {
    const all = await compare(demo, familyWeekId, `?asOf=${ANCHOR}`);
    const ids = all.available.map((a) => a.storeId);
    const cheapest = all.cheapestStoreId ?? -1;
    const without = ids.filter((id) => id !== cheapest);
    const r = await compare(demo, familyWeekId, `?asOf=${ANCHOR}&stores=${without.join(',')}`);
    expect(r.totals.map((t) => t.storeId)).toEqual(without);
    expect(r.available.find((a) => a.storeId === cheapest)).toEqual({
      storeId: cheapest,
      included: false,
    });
    expect(r.cheapestStoreId).not.toBe(cheapest);
    expect(r.excluded).toContainEqual({ storeId: cheapest, reason: 'not_selected' });
  });

  it('a date before any price history leaves every store incomplete', async () => {
    const r = await compare(demo, familyWeekId, '?asOf=2024-01-01');
    expect(r.cheapestStoreId).toBeNull();
    expect(r.savingsPct).toBeNull();
    expect(r.totals.every((t) => !t.complete && t.missingCount === 35)).toBe(true);
  });

  it('validates query parameters and ownership', async () => {
    await request(app)
      .get(`/api/v1/lists/${familyWeekId}/comparison?asOf=2026-13-40`)
      .set('Cookie', demo)
      .expect(400);
    await request(app)
      .get(`/api/v1/lists/${familyWeekId}/comparison?stores=abc`)
      .set('Cookie', demo)
      .expect(400);
    const stranger = await signUp(app, 'stranger');
    await request(app)
      .get(`/api/v1/lists/${familyWeekId}/comparison`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    await request(app).get(`/api/v1/lists/${familyWeekId}/comparison`).expect(401);
  });
});

describe('loyalty and membership change the answer', () => {
  it('turning the Kroger card off raises Kroger’s total; adding Sam’s membership adds Sam’s', async () => {
    const u = await signUp(app, 'loyal');
    await request(app)
      .patch('/api/v1/me')
      .set(CSRF)
      .set('Cookie', u.cookie)
      .send({ homeZip: '75034' })
      .expect(200);
    const list = (
      await request(app)
        .post('/api/v1/lists')
        .set(CSRF)
        .set('Cookie', u.cookie)
        .send({ name: 'Basics' })
        .expect(201)
    ).body as { list: { id: string } };
    for (const q of [
      '2 gal whole milk',
      '18 eggs',
      '3 lb ground beef',
      'bacon',
      'butter',
      'coffee',
      'ketchup',
      'salsa',
    ]) {
      await request(app)
        .post(`/api/v1/lists/${list.list.id}/items`)
        .set(CSRF)
        .set('Cookie', u.cookie)
        .send({ rawText: q })
        .expect(201);
    }
    const mine = MyStoresResponse.parse(
      (await request(app).get('/api/v1/me/stores').set('Cookie', u.cookie)).body,
    );
    const put = (f: (s: (typeof mine.stores)[number]) => object) =>
      request(app)
        .put('/api/v1/me/stores')
        .set(CSRF)
        .set('Cookie', u.cookie)
        .send({
          stores: mine.stores.map((s) => ({
            storeId: s.id,
            enabled: s.enabled,
            hasMembership: false,
            hasLoyalty: s.loyaltyProgram !== null,
            preferredLocationId: null,
            ...f(s),
          })),
        })
        .expect(200);
    const kroger = mine.stores.find((s) => s.slug === 'kroger')?.id ?? 0;
    const sams = mine.stores.find((s) => s.slug === 'sams')?.id ?? 0;
    const withCard = await compare(u.cookie, list.list.id, `?asOf=${ANCHOR}`);
    await put((s) => (s.slug === 'kroger' ? { hasLoyalty: false } : {}));
    const noCard = await compare(u.cookie, list.list.id, `?asOf=${ANCHOR}`);
    const total = (r: typeof withCard, id: number) =>
      r.totals.find((t) => t.storeId === id)?.totalCents ?? 0;
    expect(total(noCard, kroger)).toBeGreaterThan(total(withCard, kroger));
    expect(
      noCard.lines.flatMap((l) => l.stores).filter((s) => s.storeId === kroger && s.memberPrice),
    ).toEqual([]);
    expect(withCard.totals.map((t) => t.storeId)).not.toContain(sams);
    await put((s) => (s.slug === 'sams' ? { hasMembership: true } : {}));
    const member = await compare(u.cookie, list.list.id, `?asOf=${ANCHOR}`);
    expect(member.totals.map((t) => t.storeId)).toContain(sams);
  });
});

describe('GET /products/:id/offers', () => {
  it('lists offers at the user’s stores, cheapest unit price first and flagged', async () => {
    const milk = ProductsResponse.parse(
      (await request(app).get('/api/v1/products?q=whole%20milk')).body,
    ).products[0];
    const r = ProductOffersResponse.parse(
      (
        await request(app)
          .get(`/api/v1/products/${milk?.id ?? ''}/offers?asOf=${ANCHOR}`)
          .set('Cookie', demo)
          .expect(200)
      ).body,
    );
    const slug = new Map(r.stores.map((s) => [s.id, s.slug]));
    expect(r.offers.length).toBeGreaterThan(5);
    const units = r.offers.map((o) => o.unitPriceCents);
    expect(units).toEqual([...units].sort((a, b) => a - b));
    expect(r.offers[0]?.cheapest).toBe(true);
    expect(r.offers.filter((o) => o.cheapest).every((o) => o.unitPriceCents === units[0])).toBe(
      true,
    );
    expect(r.offers.map((o) => slug.get(o.storeId))).not.toContain('sams');
    expect(r.offers.every((o) => o.priceCents <= o.regularPriceCents)).toBe(true);
    await request(app)
      .get(`/api/v1/products/${milk?.id ?? ''}/offers`)
      .expect(401);
  });
});
