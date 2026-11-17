import { recommend, type OptimizedPlan as CorePlan } from '@sgs/core';
import { createDb, products, runMigrations, stores, type DbHandle } from '@sgs/db';
import { recreateDatabase, testDatabaseUrl } from '@sgs/db/testing';
import { DEMO_EMAIL, DEFAULT_DEMO_PASSWORD, seedDatabase } from '@sgs/pricing';
import {
  ComparisonResponse,
  ListsResponse,
  OptimizeResponse,
  TripResponse,
  type OptimizedPlan,
} from '@sgs/shared';
import { asc } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, cookieValues, CSRF, signUp, TestClock } from './helpers.js';

const TODAY = '2026-11-01';
let handle: DbHandle;
let app: ReturnType<typeof buildApp>;
let demo: string;
let listId: string;

beforeAll(async () => {
  const url = testDatabaseUrl('api_optimize');
  await recreateDatabase(url);
  await runMigrations(url);
  await seedDatabase({ url, seed: '20261116', anchorDate: TODAY });
  handle = createDb(url);
  const clock = new TestClock();
  clock.now = new Date(`${TODAY}T18:00:00Z`);
  app = buildApp(
    { ...handle, url },
    {
      clock,
      config: {
        webOrigin: 'http://web.test',
        cookieSecure: false,
        preselectRadiusMiles: 7,
        defaultOrigin: { lat: 33.15, lng: -96.8065 },
        fuelCentsPerGalDefault: 279,
      },
    },
  );
  const login = await request(app)
    .post('/api/v1/auth/login')
    .set(CSRF)
    .send({ email: DEMO_EMAIL, password: DEFAULT_DEMO_PASSWORD })
    .expect(200);
  demo = `sgs_at=${cookieValues(login.headers['set-cookie']).sgs_at ?? ''}`;
  const lists = ListsResponse.parse(
    (await request(app).get('/api/v1/lists').set('Cookie', demo).expect(200)).body,
  );
  listId = lists.lists.find((l) => l.name === 'Family week')?.id ?? '';
}, 120_000);
afterAll(async () => {
  await handle.close();
});

const run = async (body: object, cookie = demo, id = listId) =>
  OptimizeResponse.parse(
    (
      await request(app)
        .post(`/api/v1/lists/${id}/optimize`)
        .set(CSRF)
        .set('Cookie', cookie)
        .send(body)
        .expect(200)
    ).body,
  );

const asCore = (p: OptimizedPlan): CorePlan => ({
  ...p,
  assignments: [],
  missing: p.missing.map((m) => m.itemId),
});

describe('POST /lists/:id/optimize', () => {
  it('maxStores 1 with free fuel is the Phase 4 cheapest store', async () => {
    const cmp = ComparisonResponse.parse(
      (await request(app).get(`/api/v1/lists/${listId}/comparison`).set('Cookie', demo).expect(200))
        .body,
    );
    const r = await run({ maxStores: 1, fuelCentsPerGal: 1 });
    expect(r.settings.matchesTrip).toBe(false);
    expect(r.multi).toEqual([]);
    const cheapest = cmp.totals.find((t) => t.storeId === cmp.cheapestStoreId);
    // 1¢/gal fuel is at most a few cents, smaller than any gap between store totals here.
    expect(r.single.storeIds).toEqual([cmp.cheapestStoreId]);
    expect(r.single.itemsCents).toBe(cheapest?.totalCents);
    expect(r.single.totalCents).toBe(r.single.itemsCents + r.single.fuelCents);
  });

  it('enumerates every subset of up to 3 stores and ranks plans consistently', async () => {
    const r = await run({});
    expect(r.maxStores).toBe(3);
    expect(r.settings).toMatchObject({
      mpg: 25,
      fuelCentsPerGal: 279,
      timeValueCentsPerHour: 0,
      minutesPerStop: 10,
      matchesTrip: true,
    });
    const cmp = ComparisonResponse.parse(
      (await request(app).get(`/api/v1/lists/${listId}/comparison`).set('Cookie', demo).expect(200))
        .body,
    );
    const n = cmp.totals.length;
    expect(r.subsetsEvaluated).toBe(n + (n * (n - 1)) / 2 + (n * (n - 1) * (n - 2)) / 6);
    for (const p of [r.single, ...r.multi]) {
      expect(p.itemsCents).toBe(p.assignments.reduce((t, a) => t + a.lineCents, 0));
      expect(p.totalCents).toBe(p.itemsCents + p.fuelCents + p.timeCents);
      expect(new Set(p.route)).toEqual(new Set(p.storeIds));
      expect([...p.storeIds].sort((a, b) => a - b)).toEqual(p.storeIds);
      for (const a of p.assignments) expect(p.storeIds).toContain(a.storeId);
    }
    expect(r.multi.every((p) => p.storeIds.length >= 2)).toBe(true);
    const totals = r.multi.map((p) => p.totalCents);
    expect([...totals].sort((a, b) => a - b)).toEqual(totals);
    expect(r.recommendation).toEqual(
      recommend(asCore(r.single), r.multi[0] ? asCore(r.multi[0]) : undefined),
    );
  });

  it('logging a plan as a trip records exactly the plan’s savings', async () => {
    const r = await run({ maxStores: 3 });
    for (const plan of [r.single, r.multi[0]]) {
      if (!plan) continue;
      const res = await request(app)
        .post('/api/v1/trips')
        .set(CSRF)
        .set('Cookie', demo)
        .send({ listId, plan: { storeIds: plan.storeIds }, shoppedOn: TODAY })
        .expect(201);
      const trip = TripResponse.parse(res.body).trip;
      expect(trip.itemsTotalCents).toBe(plan.itemsCents);
      expect(trip.fuelCostCents).toBe(plan.fuelCents);
      expect(trip.distanceMiles).toBe(plan.distanceMiles);
      expect(trip.baselineTotalCents).toBe(plan.baselineCents);
      expect(trip.savingsCents).toBe(plan.savingsVsBaselineCents);
      expect(trip.stores.map((s) => s.id)).toEqual(plan.route);
    }
  });

  it('time cost only changes ranking costs, never the trip savings', async () => {
    const free = await run({ maxStores: 2 });
    const paid = await run({ maxStores: 2, timeValueCentsPerHour: 2400, minutesPerStop: 12 });
    expect(paid.single.timeCents).toBeGreaterThan(0);
    const same = paid.single.storeIds.join() === free.single.storeIds.join();
    if (same) expect(paid.single.savingsVsBaselineCents).toBe(free.single.savingsVsBaselineCents);
    for (const p of paid.multi) expect(p.timeCents).toBeGreaterThan(paid.single.timeCents - 1);
  });

  it('validates input, hides other users’ lists and needs a session', async () => {
    for (const body of [
      { maxStores: 4 },
      { maxStores: 0 },
      { maxStores: 2, budget: 1 },
      { mpg: -3 },
    ]) {
      const res = await request(app)
        .post(`/api/v1/lists/${listId}/optimize`)
        .set(CSRF)
        .set('Cookie', demo)
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const other = await signUp(app, 'nosy');
    await request(app)
      .post(`/api/v1/lists/${listId}/optimize`)
      .set(CSRF)
      .set('Cookie', other.cookie)
      .send({})
      .expect(404);
    await request(app).post(`/api/v1/lists/${listId}/optimize`).set(CSRF).send({}).expect(401);
  });

  it('an empty list is a $0 plan', async () => {
    const created = await request(app)
      .post('/api/v1/lists')
      .set(CSRF)
      .set('Cookie', demo)
      .send({ name: 'Empty' })
      .expect(201);
    const r = await run({}, demo, (created.body as { list: { id: string } }).list.id);
    expect(r.single).toMatchObject({ storeIds: [], totalCents: 0, distanceMiles: 0 });
    expect(r.multi).toEqual([]);
    expect(r.recommendation.kind).toBe('single');
  });

  it('100-item list, all 10 stores, maxStores 3: p95 under 500 ms end to end', async () => {
    const u = await signUp(app, 'bulk');
    await request(app)
      .patch('/api/v1/me')
      .set(CSRF)
      .set('Cookie', u.cookie)
      .send({ homeZip: '75034', completeOnboarding: true })
      .expect(200);
    const all = await handle.db
      .select({ id: stores.id, club: stores.requiresMembership, loyalty: stores.loyaltyProgram })
      .from(stores)
      .orderBy(asc(stores.id));
    await request(app)
      .put('/api/v1/me/stores')
      .set(CSRF)
      .set('Cookie', u.cookie)
      .send({
        stores: all.map((s) => ({
          storeId: s.id,
          enabled: true,
          hasMembership: s.club,
          hasLoyalty: s.loyalty !== null,
          preferredLocationId: null,
        })),
      })
      .expect(200);
    const created = await request(app)
      .post('/api/v1/lists')
      .set(CSRF)
      .set('Cookie', u.cookie)
      .send({ name: 'Big' })
      .expect(201);
    const id = (created.body as { list: { id: string } }).list.id;
    const prods = await handle.db
      .select({ id: products.id, name: products.name })
      .from(products)
      .orderBy(asc(products.name))
      .limit(100);
    for (const p of prods) {
      await request(app)
        .post(`/api/v1/lists/${id}/items`)
        .set(CSRF)
        .set('Cookie', u.cookie)
        .send({ rawText: p.name, productId: p.id })
        .expect(201);
    }
    const times: number[] = [];
    let last: OptimizeResponse | null = null;
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      last = await run({ maxStores: 3 }, u.cookie, id);
      times.push(performance.now() - t0);
    }
    expect(last?.subsetsEvaluated).toBe(10 + 45 + 120);
    times.sort((a, b) => a - b);
    expect(times[18] ?? Infinity).toBeLessThan(500);
  }, 120_000);
});
