import { randomUUID } from 'node:crypto';
import { addDays, bucketsBetween, bucketStart, parseCsv, type IsoDate } from '@sgs/core';
import {
  categories,
  createDb,
  runMigrations,
  stores,
  tripItems,
  trips,
  type DbHandle,
} from '@sgs/db';
import { recreateDatabase, testDatabaseUrl } from '@sgs/db/testing';
import { DEMO_EMAIL, DEFAULT_DEMO_PASSWORD, seedDatabase } from '@sgs/pricing';
import {
  ComparisonResponse,
  DashboardBreakdown,
  DashboardSeries,
  DashboardSummary,
  ErrorResponse,
  ListsResponse,
  TripResponse,
  TripsResponse,
  type TripDetail,
} from '@sgs/shared';
import { asc, sql } from 'drizzle-orm';
import { PDFParse } from 'pdf-parse';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOM, kpiRows, PDF_TRIPS_PER_PAGE } from '../src/services/exports.js';
import { buildApp, cookieValues, CSRF, signUp, TestClock } from './helpers.js';

const TODAY = '2026-11-01';
let handle: DbHandle;
let app: ReturnType<typeof buildApp>;
const clock = new TestClock();
let demo: string;
let listId: string;

beforeAll(async () => {
  const url = testDatabaseUrl('api_trips');
  await recreateDatabase(url);
  await runMigrations(url);
  await seedDatabase({ url, seed: '20261116', anchorDate: TODAY });
  handle = createDb(url);
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
        demoPrices: true,
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
  expect(listId).not.toBe('');
}, 120_000);
afterAll(async () => {
  await handle.close();
});

const compare = async (asOf: IsoDate) =>
  ComparisonResponse.parse(
    (
      await request(app)
        .get(`/api/v1/lists/${listId}/comparison?asOf=${asOf}`)
        .set('Cookie', demo)
        .expect(200)
    ).body,
  );

const commit = (cookie: string, body: unknown) =>
  request(app)
    .post('/api/v1/trips')
    .set(CSRF)
    .set('Cookie', cookie)
    .send(body as object);

async function commitOk(storeIds: number[], shoppedOn: IsoDate): Promise<TripDetail> {
  const res = await commit(demo, { listId, plan: { storeIds }, shoppedOn });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return TripResponse.parse(res.body).trip;
}

describe('POST /trips (server recomputes, then snapshots)', () => {
  it('a single-store trip equals the comparison at price_as_of, minus fuel', async () => {
    const cmp = await compare(TODAY);
    const cheapest = cmp.cheapestStoreId;
    expect(cheapest).not.toBeNull();
    const cheapTotal = cmp.totals.find((t) => t.storeId === cheapest);
    expect(cheapTotal?.complete).toBe(true);
    const trip = await commitOk([cheapest ?? 0], TODAY);
    expect(trip.planType).toBe('single');
    expect(trip.priceAsOf).toBe(TODAY);
    expect(trip.stores.map((s) => s.id)).toEqual([cheapest]);
    expect(trip.baselineStore.id).toBe(cmp.baseline.storeId);
    // Both stores carry every priced item, so the trip covers the whole list on both sides.
    expect(trip.itemsTotalCents).toBe(cheapTotal?.totalCents);
    expect(trip.baselineTotalCents).toBe(cmp.baseline.totalCents);
    expect(trip.items.reduce((s, i) => s + i.lineCents, 0)).toBe(trip.itemsTotalCents);
    expect(trip.distanceMiles).toBeGreaterThan(0);
    expect(trip.fuelCostCents).toBe(
      Math.round((trip.distanceMiles / trip.mpg) * trip.fuelCentsPerGal),
    );
    expect(trip.savingsCents).toBe(
      trip.baselineTotalCents - trip.itemsTotalCents - trip.fuelCostCents,
    );
  });

  it('backdated trips are priced on the day shopped', async () => {
    const day = addDays(TODAY, -45);
    const cmp = await compare(day);
    const store = cmp.cheapestStoreId ?? 0;
    const trip = await commitOk([store], day);
    expect(trip.priceAsOf).toBe(day);
    expect(trip.itemsTotalCents).toBe(cmp.totals.find((t) => t.storeId === store)?.totalCents);
  });

  it('multi-store: each item goes to the cheaper of the plan stores', async () => {
    const cmp = await compare(TODAY);
    const [a, b] = cmp.totals.filter((t) => t.complete).map((t) => t.storeId);
    const trip = await commitOk([a ?? 0, b ?? 0], TODAY);
    expect(trip.planType).toBe('multi');
    expect(new Set(trip.stores.map((s) => s.id))).toEqual(new Set([a, b]));
    for (const item of trip.items) {
      const line = cmp.lines.find((l) => l.itemId === item.itemId);
      const lines = (line?.stores ?? [])
        .filter((s) => (s.storeId === a || s.storeId === b) && s.lineCents !== null)
        .map((s) => s.lineCents ?? 0);
      expect(item.lineCents).toBe(Math.min(...lines));
    }
  });

  it('refuses client totals, bad dates, foreign lists and stores the user does not shop at', async () => {
    const cmp = await compare(TODAY);
    const store = cmp.cheapestStoreId ?? 0;
    const extra = await commit(demo, {
      listId,
      plan: { storeIds: [store], itemsTotalCents: 1 },
      shoppedOn: TODAY,
    });
    expect(extra.status).toBe(400);
    const future = await commit(demo, {
      listId,
      plan: { storeIds: [store] },
      shoppedOn: addDays(TODAY, 1),
    });
    expect(future.status).toBe(422);
    expect(ErrorResponse.parse(future.body).error.code).toBe('VALIDATION_FAILED');
    const old = await commit(demo, {
      listId,
      plan: { storeIds: [store] },
      shoppedOn: addDays(TODAY, -366),
    });
    expect(old.status).toBe(422);
    const notMine = cmp.excluded[0]?.storeId ?? 999;
    expect(
      (await commit(demo, { listId, plan: { storeIds: [notMine] }, shoppedOn: TODAY })).status,
    ).toBe(422);
    const other = await signUp(app, 'other');
    expect(
      (await commit(other.cookie, { listId, plan: { storeIds: [store] }, shoppedOn: TODAY }))
        .status,
    ).toBe(404);
  });

  it('a committed trip never changes when prices, store settings or the list change later', async () => {
    const cmp = await compare(TODAY);
    const trip = await commitOk([cmp.cheapestStoreId ?? 0], TODAY);
    // Double every price and rename the list after committing.
    await handle.db.execute(
      sql`UPDATE price_points SET regular_price_cents = regular_price_cents * 2`,
    );
    await request(app)
      .patch(`/api/v1/lists/${listId}`)
      .set(CSRF)
      .set('Cookie', demo)
      .send({ name: 'Renamed week' })
      .expect(200);
    const again = TripResponse.parse(
      (await request(app).get(`/api/v1/trips/${trip.id}`).set('Cookie', demo).expect(200)).body,
    ).trip;
    expect(again).toEqual(trip);
    expect(
      (await compare(TODAY)).totals.find((t) => t.storeId === trip.stores[0]?.id)?.totalCents,
    ).not.toBe(trip.itemsTotalCents);
    await handle.db.execute(
      sql`UPDATE price_points SET regular_price_cents = regular_price_cents / 2`,
    );
    await request(app)
      .patch(`/api/v1/lists/${listId}`)
      .set(CSRF)
      .set('Cookie', demo)
      .send({ name: 'Family week' })
      .expect(200);
  });

  it('lists newest first, hides other users’ trips (404), and deletes', async () => {
    const page = TripsResponse.parse(
      (await request(app).get('/api/v1/trips?limit=2').set('Cookie', demo).expect(200)).body,
    );
    expect(page.trips).toHaveLength(2);
    expect(page.nextCursor).toBe('2');
    const dates = page.trips.map((t) => t.shoppedOn);
    expect([...dates].sort().reverse()).toEqual(dates);
    const id = page.trips[0]?.id ?? '';
    const other = await signUp(app, 'peek');
    await request(app).get(`/api/v1/trips/${id}`).set('Cookie', other.cookie).expect(404);
    await request(app)
      .delete(`/api/v1/trips/${id}`)
      .set(CSRF)
      .set('Cookie', other.cookie)
      .expect(404);
    const trip = await commitOk([(await compare(TODAY)).cheapestStoreId ?? 0], TODAY);
    await request(app).delete(`/api/v1/trips/${trip.id}`).set(CSRF).set('Cookie', demo).expect(204);
    await request(app).get(`/api/v1/trips/${trip.id}`).set('Cookie', demo).expect(404);
    await request(app).get('/api/v1/trips').expect(401);
  });

  it('“today” is the America/Chicago date: 9 pm on Jan 31 in Dallas is still January', async () => {
    const saved = clock.now;
    clock.now = new Date('2026-02-01T03:00:00Z'); // Jan 31, 9 pm CST
    try {
      const store = (await compare('2026-01-31')).cheapestStoreId ?? 0;
      const tooSoon = await commit(demo, {
        listId,
        plan: { storeIds: [store] },
        shoppedOn: '2026-02-01',
      });
      expect(tooSoon.status).toBe(422);
      const trip = await commitOk([store], '2026-01-31');
      const s = DashboardSeries.parse(
        (
          await request(app)
            .get('/api/v1/dashboard/series?from=2026-01-01&to=2026-02-28&interval=month')
            .set('Cookie', demo)
            .expect(200)
        ).body,
      );
      expect(s.points.find((p) => p.start === '2026-01-01')?.valueCents).toBe(trip.savingsCents);
      expect(s.points.find((p) => p.start === '2026-02-01')?.tripCount).toBe(0);
    } finally {
      clock.now = saved;
    }
  });
});

// ── Aggregation on a hand-built ledger (independent of pricing) ──

interface LedgerTrip {
  shoppedOn: IsoDate;
  storeId: number;
  lines: { categoryId: number; line: number; baseline: number }[];
  fuel: number;
}

async function insertLedger(
  userId: string,
  entries: LedgerTrip[],
  storeNames: Map<number, string>,
) {
  for (const e of entries) {
    const items = e.lines.reduce((s, l) => s + l.line, 0);
    const baseline = e.lines.reduce((s, l) => s + l.baseline, 0);
    const name = storeNames.get(e.storeId) ?? '';
    const [row] = await handle.db
      .insert(trips)
      .values({
        userId,
        planType: 'single',
        storeIds: [e.storeId],
        baselineStoreId: e.storeId,
        itemsTotalCents: items,
        fuelCostCents: e.fuel,
        distanceMiles: e.fuel / 10,
        baselineTotalCents: baseline,
        priceAsOf: e.shoppedOn,
        shoppedOn: e.shoppedOn,
        plan: {
          v: 1,
          listName: '=SUM(A1:A9)',
          stores: [{ id: e.storeId, name }],
          baselineStore: { id: e.storeId, name },
          items: e.lines.map((l, i) => ({
            itemId: `x${String(i)}`,
            rawText: 'thing',
            productName: `Thing ${String(i)}`,
            categoryName: null,
            storeId: e.storeId,
            storeItemId: randomUUID(),
            title: `Thing ${String(i)}`,
            packages: 1,
            lineCents: l.line,
            baselineLineCents: l.baseline,
            unitPriceCents: l.line,
            displayUnit: 'ea',
            onSale: false,
            promoLabel: null,
            approximate: false,
          })),
          skipped: [],
          mpg: 25,
          fuelCentsPerGal: 279,
        },
      })
      .returning({ id: trips.id });
    await handle.db.insert(tripItems).values(
      e.lines.map((l) => ({
        tripId: row?.id ?? '',
        storeId: e.storeId,
        categoryId: l.categoryId,
        packages: 1,
        baseQuantity: 1,
        lineTotalCents: l.line,
        baselineLineCents: l.baseline,
      })),
    );
  }
}

describe('dashboard aggregation, CSV and PDF on a seeded ledger', () => {
  let user: { cookie: string; userId: string };
  let ledger: LedgerTrip[];
  let storeIds: number[];
  let storeNames: Map<number, string>;
  const FROM = '2025-11-01';
  const TO = TODAY;

  beforeAll(async () => {
    user = await signUp(app, 'ledger');
    const s = await handle.db
      .select({ id: stores.id, name: stores.name })
      .from(stores)
      .orderBy(asc(stores.id));
    storeIds = s.map((x) => x.id);
    storeNames = new Map(s.map((x) => [x.id, x.name]));
    const cats = (
      await handle.db
        .select({ id: categories.id })
        .from(categories)
        .orderBy(asc(categories.id))
        .limit(3)
    ).map((c) => c.id);
    ledger = Array.from({ length: 45 }, (_, k) => ({
      shoppedOn: addDays('2025-11-05', k * 8),
      storeId: storeIds[k % 3] ?? 1,
      lines: [
        { categoryId: cats[k % 3] ?? 1, line: 600 + 13 * k, baseline: 700 + 11 * k },
        // Every 5th trip loses money vs baseline: negative savings must be counted.
        {
          categoryId: cats[(k + 1) % 3] ?? 1,
          line: 400 + k,
          baseline: k % 5 === 0 ? 100 : 420 + k,
        },
      ],
      fuel: (k % 3) * 25,
    }));
    // Month edges.
    ledger.push(
      {
        shoppedOn: '2026-01-31',
        storeId: storeIds[0] ?? 1,
        lines: [{ categoryId: cats[0] ?? 1, line: 1000, baseline: 1300 }],
        fuel: 0,
      },
      {
        shoppedOn: '2026-02-01',
        storeId: storeIds[1] ?? 1,
        lines: [{ categoryId: cats[0] ?? 1, line: 1000, baseline: 900 }],
        fuel: 50,
      },
    );
    await insertLedger(user.userId, ledger, storeNames);
  });

  const get = async (path: string, cookie = user.cookie) =>
    (await request(app).get(`/api/v1${path}`).set('Cookie', cookie).expect(200)).body as unknown;
  const savingsOf = (t: LedgerTrip) =>
    t.lines.reduce((s, l) => s + l.baseline - l.line, 0) - t.fuel;
  const inRange = (from: IsoDate, to: IsoDate) =>
    ledger.filter((t) => t.shoppedOn >= from && t.shoppedOn <= to);

  it('summary totals equal the sum of trips (negative savings included)', async () => {
    const s = DashboardSummary.parse(await get(`/dashboard/summary?from=${FROM}&to=${TO}`));
    const mine = inRange(FROM, TO);
    expect(mine.some((t) => savingsOf(t) < 0)).toBe(true);
    const saved = mine.reduce((a, t) => a + savingsOf(t), 0);
    const baseline = mine.reduce((a, t) => a + t.lines.reduce((x, l) => x + l.baseline, 0), 0);
    expect(s.tripCount).toBe(mine.length);
    expect(s.totalSavedCents).toBe(saved);
    expect(s.baselineTotalCents).toBe(baseline);
    expect(s.fuelSpentCents).toBe(mine.reduce((a, t) => a + t.fuel, 0));
    expect(s.totalSpentCents).toBe(baseline - saved);
    expect(s.avgSavingsPct).toBe(Math.round((saved / baseline) * 1000) / 10);
    const perStore = new Map<number, number>();
    for (const t of mine)
      for (const l of t.lines)
        perStore.set(t.storeId, (perStore.get(t.storeId) ?? 0) + l.baseline - l.line);
    const best = [...perStore].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    expect(s.bestStore).toEqual({
      storeId: best?.[0],
      name: storeNames.get(best?.[0] ?? 0),
      savedCents: best?.[1],
    });
  });

  it('series: every month/week bucket, zero-filled, summing to the total', async () => {
    for (const interval of ['month', 'week'] as const) {
      for (const metric of ['savings', 'spend'] as const) {
        const s = DashboardSeries.parse(
          await get(
            `/dashboard/series?from=${FROM}&to=${TO}&interval=${interval}&metric=${metric}`,
          ),
        );
        expect(s.points.map((p) => p.start)).toEqual(bucketsBetween(FROM, TO, interval));
        const expected = new Map<string, number>();
        for (const t of inRange(FROM, TO)) {
          const v =
            metric === 'savings' ? savingsOf(t) : t.lines.reduce((a, l) => a + l.line, 0) + t.fuel;
          const b = bucketStart(t.shoppedOn, interval);
          expected.set(b, (expected.get(b) ?? 0) + v);
        }
        for (const p of s.points) expect(p.valueCents).toBe(expected.get(p.start) ?? 0);
      }
    }
    const m = DashboardSeries.parse(
      await get('/dashboard/series?from=2026-01-01&to=2026-02-28&interval=month'),
    );
    const jan = ledger.filter((t) => t.shoppedOn.startsWith('2026-01'));
    expect(m.points[0]).toEqual({
      start: '2026-01-01',
      valueCents: jan.reduce((a, t) => a + savingsOf(t), 0),
      tripCount: jan.length,
    });
  });

  it('breakdowns by store and category add up to item-level savings', async () => {
    const mine = inRange(FROM, TO);
    const itemSaved = mine.reduce(
      (a, t) => a + t.lines.reduce((x, l) => x + l.baseline - l.line, 0),
      0,
    );
    for (const by of ['store', 'category'] as const) {
      const b = DashboardBreakdown.parse(
        await get(`/dashboard/breakdown?from=${FROM}&to=${TO}&by=${by}`),
      );
      expect(b.rows.reduce((a, r) => a + r.savedCents, 0)).toBe(itemSaved);
      expect(b.rows.reduce((a, r) => a + r.itemCount, 0)).toBe(
        mine.reduce((a, t) => a + t.lines.length, 0),
      );
      const saved = b.rows.map((r) => r.savedCents);
      expect([...saved].sort((x, y) => y - x)).toEqual(saved);
    }
  });

  it('an empty range returns zeros, not errors; bad ranges are 400', async () => {
    const s = DashboardSummary.parse(await get('/dashboard/summary?from=2020-01-01&to=2020-03-31'));
    expect(s).toMatchObject({
      tripCount: 0,
      totalSavedCents: 0,
      totalSpentCents: 0,
      fuelSpentCents: 0,
      avgSavingsPct: null,
      bestStore: null,
    });
    const series = DashboardSeries.parse(
      await get('/dashboard/series?from=2020-01-01&to=2020-03-31'),
    );
    expect(series.points).toHaveLength(3);
    expect(series.points.every((p) => p.valueCents === 0 && p.tripCount === 0)).toBe(true);
    expect(
      DashboardBreakdown.parse(await get('/dashboard/breakdown?from=2020-01-01&to=2020-03-31'))
        .rows,
    ).toEqual([]);
    for (const q of [
      'from=2026-02-01&to=2026-01-01',
      'from=2026-02-30',
      'to=nope',
      'from=2000-01-01&to=2026-01-01',
    ]) {
      const r = await request(app).get(`/api/v1/dashboard/summary?${q}`).set('Cookie', user.cookie);
      expect(r.status, q).toBe(400);
    }
    // Another user's ledger is invisible.
    const other = await signUp(app, 'empty');
    expect(
      DashboardSummary.parse(await get(`/dashboard/summary?from=${FROM}&to=${TO}`, other.cookie))
        .tripCount,
    ).toBe(0);
  });

  it('CSV: RFC 4180, formula-safe, Saved column sums to the dashboard total', async () => {
    const res = await request(app)
      .get(`/api/v1/exports/savings.csv?from=${FROM}&to=${TO}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="savings-${FROM}-to-${TO}.csv"`,
    );
    const text = res.text;
    expect(text.startsWith(BOM)).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replaceAll('\r\n', '').includes('\n')).toBe(false); // CRLF only
    const rows = parseCsv(text).map((r) => r.cells);
    const [header, ...body] = rows;
    expect(header?.[0]).toBe('Date');
    const mine = inRange(FROM, TO);
    expect(body.filter((r) => r[3] === 'item')).toHaveLength(
      mine.reduce((a, t) => a + t.lines.length, 0),
    );
    expect(body.filter((r) => r[3] === 'fuel')).toHaveLength(mine.filter((t) => t.fuel > 0).length);
    // The list name "=SUM(A1:A9)" is escaped so a spreadsheet shows text instead of running it.
    expect(body.every((r) => r[2] === "'=SUM(A1:A9)")).toBe(true);
    expect(body.every((r) => r.length === header?.length)).toBe(true);
    const savedCents = body.reduce((a, r) => a + Math.round(Number(r[12]) * 100), 0);
    const s = DashboardSummary.parse(await get(`/dashboard/summary?from=${FROM}&to=${TO}`));
    expect(savedCents).toBe(s.totalSavedCents);
    expect(body.some((r) => (r[12] ?? '').startsWith('-'))).toBe(true); // negatives stay numeric
  });

  it('PDF: valid, one page per ≤ 40 trips, totals match the API', async () => {
    const pdfFor = async (from: IsoDate, to: IsoDate, cookie = user.cookie) => {
      const res = await request(app)
        .get(`/api/v1/exports/savings.pdf?from=${from}&to=${to}`)
        .set('Cookie', cookie)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => {
            cb(null, Buffer.concat(chunks));
          });
        })
        .expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      const buf = res.body as Buffer;
      expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      try {
        return await parser.getText();
      } finally {
        await parser.destroy();
      }
    };
    const mine = inRange(FROM, TO);
    expect(mine.length).toBeGreaterThan(PDF_TRIPS_PER_PAGE);
    const full = await pdfFor(FROM, TO);
    expect(full.total).toBe(Math.ceil(mine.length / PDF_TRIPS_PER_PAGE));
    const s = DashboardSummary.parse(await get(`/dashboard/summary?from=${FROM}&to=${TO}`));
    for (const [label, value] of kpiRows(s)) {
      expect(full.text).toContain(label);
      expect(full.text).toContain(value);
    }
    const few = await pdfFor('2026-01-01', '2026-02-28');
    expect(few.total).toBe(1);
    const none = await pdfFor('2020-01-01', '2020-02-01');
    expect(none.total).toBe(1);
    expect(none.text).toContain('No trips in this period.');
  });

  it('exports are private', async () => {
    await request(app).get('/api/v1/exports/savings.csv').expect(401);
    await request(app).get('/api/v1/exports/savings.pdf').expect(401);
    const other = await signUp(app, 'csvpeek');
    const csv = await request(app)
      .get(`/api/v1/exports/savings.csv?from=${FROM}&to=${TO}`)
      .set('Cookie', other.cookie)
      .expect(200);
    expect(parseCsv(csv.text)).toHaveLength(1); // header only
  });
});
