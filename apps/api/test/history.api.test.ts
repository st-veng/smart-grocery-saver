import { addDays, diffDays } from '@sgs/core';
import { createDb, products, runMigrations, type DbHandle } from '@sgs/db';
import { recreateDatabase, testDatabaseUrl } from '@sgs/db/testing';
import { DEMO_EMAIL, DEFAULT_DEMO_PASSWORD, seedDatabase } from '@sgs/pricing';
import {
  AlertResponse,
  AlertsResponse,
  ErrorResponse,
  HistoryResponse,
  NotificationsResponse,
  ProductsResponse,
  StoreItemHistoryResponse,
} from '@sgs/shared';
import { asc, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, cookieValues, CSRF, signUp, TestClock } from './helpers.js';

const ANCHOR = '2026-11-01';
let handle: DbHandle;
let app: ReturnType<typeof buildApp>;
let demo: string;
let demoId: string;

beforeAll(async () => {
  const url = testDatabaseUrl('api_history');
  await recreateDatabase(url);
  await runMigrations(url);
  await seedDatabase({ url, seed: '20261116', anchorDate: ANCHOR });
  handle = createDb(url);
  const clock = new TestClock();
  clock.now = new Date(`${ANCHOR}T18:00:00Z`);
  app = buildApp(
    { ...handle, url },
    {
      clock,
      config: {
        webOrigin: 'http://web.test',
        cookieSecure: false,
        preselectRadiusMiles: 7,
        defaultOrigin: { lat: 33.15, lng: -96.8065 },
        testHooks: true,
      },
    },
  );
  const login = await request(app)
    .post('/api/v1/auth/login')
    .set(CSRF)
    .send({ email: DEMO_EMAIL, password: DEFAULT_DEMO_PASSWORD })
    .expect(200);
  demo = `sgs_at=${cookieValues(login.headers['set-cookie']).sgs_at ?? ''}`;
  demoId = (login.body as { user: { id: string } }).user.id;
}, 120_000);
afterAll(async () => {
  await handle.close();
});

const history = async (productId: string, range: string) =>
  HistoryResponse.parse(
    (
      await request(app)
        .get(`/api/v1/products/${productId}/history?range=${range}`)
        .set('Cookie', demo)
        .expect(200)
    ).body,
  );

/** Independent brute force: each day's lowest unit price per eligible store, straight from SQL. */
async function bruteDaily(productId: string, from: string, to: string) {
  const r = await handle.db.execute<{ day: string; store_id: number; u: number }>(sql`
    WITH eligible AS (
      SELECT s.id, s.requires_membership, s.loyalty_program, us.has_membership, us.has_loyalty
      FROM stores s JOIN user_stores us ON us.store_id = s.id AND us.user_id = ${demoId}
      WHERE us.enabled AND (NOT s.requires_membership OR us.has_membership)
    ), days AS (SELECT d::date AS d FROM generate_series(${from}::date, ${to}::date, interval '1 day') d)
    SELECT days.d::text AS day, si.store_id,
      min(
        (CASE WHEN pp.sale_price_cents IS NOT NULL AND pp.min_qty <= 1
                AND (NOT pp.member_only OR (e.requires_membership AND e.has_membership) OR (e.loyalty_program IS NOT NULL AND e.has_loyalty))
              THEN pp.sale_price_cents ELSE pp.regular_price_cents END)::float8
        / ((CASE WHEN si.pricing_basis = 'per_weight' THEN unit_factor(si.unit) ELSE si.base_quantity END)::float8
           * (CASE WHEN unit_dim(si.unit) = p.dimension THEN 1
                   WHEN unit_dim(si.unit) = 'mass' THEN 1.0 / p.avg_each_grams::float8
                   ELSE p.avg_each_grams::float8 END))
        * unit_factor(p.display_unit)::float8
      ) AS u
    FROM days
    JOIN price_points pp ON pp.valid_during @> days.d AND pp.store_location_id IS NULL
    JOIN store_items si ON si.id = pp.store_item_id AND si.active
    JOIN products p ON p.id = si.product_id
    JOIN eligible e ON e.id = si.store_id
    WHERE si.product_id = ${productId}
      AND (unit_dim(si.unit) = p.dimension
           OR (p.avg_each_grams IS NOT NULL AND unit_dim(si.unit) <> 'volume' AND p.dimension <> 'volume'))
    GROUP BY 1, 2`);
  return r.rows;
}

const allProducts = async () =>
  handle.db
    .select({ id: products.id, slug: products.slug })
    .from(products)
    .orderBy(asc(products.slug));

describe('GET /products/:id/history', () => {
  it('30/90/365-day ranges end today, start N-1 days earlier, and clip every series to the range', async () => {
    const milk = (await allProducts()).find((p) => p.slug === 'whole-milk');
    for (const [range, days] of [
      ['30d', 30],
      ['90d', 90],
      ['365d', 365],
    ] as const) {
      const h = await history(milk?.id ?? '', range);
      expect(h).toMatchObject({ range, to: ANCHOR, from: addDays(ANCHOR, -(days - 1)) });
      expect(h.series.length).toBeGreaterThan(3);
      for (const s of h.series) {
        expect(s.points[0]?.date).toBe(h.from);
        for (const p of s.points) {
          expect(diffDays(p.date, h.from)).toBeGreaterThanOrEqual(0);
          expect(diffDays(h.to, p.date)).toBeGreaterThanOrEqual(0);
        }
        const dates = s.points.map((p) => p.date);
        expect(dates).toEqual([...dates].sort());
      }
    }
  });

  it('every day of every store series equals the brute-force daily lowest (no gaps, no drift)', async () => {
    const all = await allProducts();
    const sample = [
      'whole-milk',
      'large-eggs',
      'bananas',
      'avocados',
      'ground-beef-80',
      'lemons',
    ].map((s) => all.find((p) => p.slug === s)?.id ?? '');
    for (const id of sample) {
      const h = await history(id, '90d');
      const brute = await bruteDaily(id, h.from, h.to);
      const byKey = new Map(brute.map((b) => [`${b.store_id}|${b.day}`, b.u]));
      for (const s of h.series) {
        for (let d = 0; d < 90; d++) {
          const day = addDays(h.from, d);
          const step =
            [...s.points].reverse().find((p) => diffDays(day, p.date) >= 0)?.unitPriceCents ?? null;
          const expected = byKey.get(`${String(s.storeId)}|${day}`) ?? null;
          if (expected === null) expect(step, `${id} ${String(s.storeId)} ${day}`).toBeNull();
          else expect(step, `${id} ${String(s.storeId)} ${day}`).toBeCloseTo(expected, 3);
        }
      }
    }
  }, 60_000);

  it('historic low equals a brute-force daily scan over 365 days for 20+ products', async () => {
    const all = await allProducts();
    const sample = all.filter((_, i) => i % 9 === 0);
    expect(sample.length).toBeGreaterThanOrEqual(20);
    for (const p of sample) {
      const h = await history(p.id, '30d');
      const brute = await bruteDaily(p.id, addDays(ANCHOR, -364), ANCHOR);
      if (brute.length === 0) {
        expect(h.historicLow).toBeNull();
        continue;
      }
      const min = Math.min(...brute.map((b) => b.u));
      const firstDay = brute
        .filter((b) => Math.abs(b.u - min) < 1e-6)
        .map((b) => b.day)
        .sort()[0];
      expect(h.historicLow?.unitPriceCents, p.slug).toBeCloseTo(min, 3);
      expect(h.historicLow?.date, p.slug).toBe(firstDay);
      const today = Math.min(...brute.filter((b) => b.day === ANCHOR).map((b) => b.u));
      expect(h.current?.unitPriceCents, p.slug).toBeCloseTo(today, 3);
      expect(h.atHistoricLow, p.slug).toBe(Math.abs(today - min) < 1e-6);
    }
  }, 60_000);

  it('store-item history shows regular vs paid package price, clipped to the range', async () => {
    const milk = (await allProducts()).find((p) => p.slug === 'whole-milk');
    const h = await history(milk?.id ?? '', '30d');
    const offers = (
      await request(app)
        .get(`/api/v1/products/${milk?.id ?? ''}/offers?asOf=${ANCHOR}`)
        .set('Cookie', demo)
    ).body as { offers: { storeItemId: string }[] };
    const item = offers.offers[0]?.storeItemId ?? '';
    const r = StoreItemHistoryResponse.parse(
      (
        await request(app)
          .get(`/api/v1/store-items/${item}/history?range=30d`)
          .set('Cookie', demo)
          .expect(200)
      ).body,
    );
    expect(r.periods[0]?.from).toBe(h.from);
    expect(r.periods.at(-1)?.to).toBeNull();
    expect(r.periods.every((p) => p.priceCents <= p.regularPriceCents)).toBe(true);
  });

  it('validates range and requires sign-in', async () => {
    const milk = (await allProducts())[0];
    await request(app)
      .get(`/api/v1/products/${milk?.id ?? ''}/history?range=7d`)
      .set('Cookie', demo)
      .expect(400);
    await request(app)
      .get(`/api/v1/products/${milk?.id ?? ''}/history`)
      .expect(401);
  });
});

describe('alerts and notifications', () => {
  it('CRUD: one alert per kind (re-creating re-activates), target requires targetCents, ownership is 404', async () => {
    const u = await signUp(app, 'alerter');
    const milk = ProductsResponse.parse(
      (await request(app).get('/api/v1/products?q=whole%20milk')).body,
    ).products[0];
    const post = (body: object) =>
      request(app).post('/api/v1/alerts').set(CSRF).set('Cookie', u.cookie).send(body);
    const a = AlertResponse.parse(
      (await post({ productId: milk?.id, kind: 'historic_low' }).expect(201)).body,
    ).alert;
    await request(app)
      .patch(`/api/v1/alerts/${a.id}`)
      .set(CSRF)
      .set('Cookie', u.cookie)
      .send({ active: false })
      .expect(200);
    const again = AlertResponse.parse(
      (await post({ productId: milk?.id, kind: 'historic_low' }).expect(201)).body,
    ).alert;
    expect(again).toMatchObject({ id: a.id, active: true });
    await post({ productId: milk?.id, kind: 'target_price' }).expect(400);
    await post({ productId: milk?.id, kind: 'historic_low', targetCents: 100 }).expect(400);
    const t = AlertResponse.parse(
      (await post({ productId: milk?.id, kind: 'target_price', targetCents: 3 }).expect(201)).body,
    ).alert;
    await request(app)
      .patch(`/api/v1/alerts/${a.id}`)
      .set(CSRF)
      .set('Cookie', u.cookie)
      .send({ targetCents: 5 })
      .expect(422);
    const list = AlertsResponse.parse(
      (await request(app).get('/api/v1/alerts').set('Cookie', u.cookie)).body,
    ).alerts;
    expect(list.map((x) => x.kind).sort()).toEqual(['historic_low', 'target_price']);
    const other = await signUp(app, 'nosy');
    await request(app)
      .patch(`/api/v1/alerts/${t.id}`)
      .set(CSRF)
      .set('Cookie', other.cookie)
      .send({ active: false })
      .expect(404);
    await request(app)
      .delete(`/api/v1/alerts/${t.id}`)
      .set(CSRF)
      .set('Cookie', other.cookie)
      .expect(404);
    await request(app)
      .delete(`/api/v1/alerts/${t.id}`)
      .set(CSRF)
      .set('Cookie', u.cookie)
      .expect(204);
  });

  it('sim advance to the planted day notifies once; reading clears the badge', async () => {
    const honey = (await allProducts()).find((p) => p.slug === 'honey');
    await request(app)
      .post('/api/v1/alerts')
      .set(CSRF)
      .set('Cookie', demo)
      .send({ productId: honey?.id, kind: 'historic_low' })
      .expect(201);
    const unread = async () =>
      NotificationsResponse.parse(
        (
          await request(app)
            .get('/api/v1/notifications?unread=true')
            .set('Cookie', demo)
            .expect(200)
        ).body,
      );
    expect((await unread()).unreadCount).toBe(0);
    const adv = (
      await request(app)
        .post('/api/v1/test/sim/advance')
        .set(CSRF)
        .send({ to: addDays(ANCHOR, 1) })
        .expect(200)
    ).body as { applied: string[] };
    expect(adv.applied).toEqual([addDays(ANCHOR, 1)]);
    await request(app)
      .post('/api/v1/test/sim/advance')
      .set(CSRF)
      .send({ to: addDays(ANCHOR, 1) })
      .expect(200); // idempotent
    const n = await unread();
    expect(n.unreadCount).toBe(1);
    expect(n.notifications[0]).toMatchObject({
      kind: 'historic_low',
      productName: 'Pure Clover Honey',
      storeName: 'Walmart',
      promoLabel: 'Clearance',
      read: false,
    });
    const nid = n.notifications[0]?.id ?? '';
    const stranger = await signUp(app, 'stranger');
    await request(app)
      .post(`/api/v1/notifications/${nid}/read`)
      .set(CSRF)
      .set('Cookie', stranger.cookie)
      .expect(404);
    await request(app)
      .post(`/api/v1/notifications/${nid}/read`)
      .set(CSRF)
      .set('Cookie', demo)
      .expect(204);
    expect((await unread()).unreadCount).toBe(0);
    const all = NotificationsResponse.parse(
      (await request(app).get('/api/v1/notifications').set('Cookie', demo)).body,
    );
    expect(all.notifications[0]?.read).toBe(true);
    await request(app)
      .post('/api/v1/notifications/read-all')
      .set(CSRF)
      .set('Cookie', demo)
      .expect(204);
  });

  it('test hooks are not mounted unless enabled', async () => {
    const plain = buildApp({ ...handle, url: '' });
    const res = await request(plain)
      .post('/api/v1/test/sim/advance')
      .set(CSRF)
      .send({ days: 1 })
      .expect(404);
    expect(ErrorResponse.parse(res.body).error.code).toBe('NOT_FOUND');
  });
});
