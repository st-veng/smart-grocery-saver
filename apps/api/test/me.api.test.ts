import { DEFAULT_ORIGIN } from '@sgs/core';
import { users } from '@sgs/db';
import {
  ErrorResponse,
  LocationsResponse,
  MeResponse,
  MyStoresResponse,
  StoresResponse,
} from '@sgs/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, cookieValues, CSRF, setupDb, type TestDb } from './helpers.js';

let db: TestDb;
let app: ReturnType<typeof buildApp>;
beforeAll(async () => {
  db = await setupDb('api_me');
  app = buildApp(db);
});
afterAll(async () => {
  await db.close();
});

let n = 0;
async function signUp() {
  const email = `me${String(++n)}@example.com`;
  const res = await request(app)
    .post('/api/v1/auth/register')
    .set(CSRF)
    .send({ email, password: 'correct horse battery', displayName: 'Me' })
    .expect(201);
  const c = cookieValues(res.headers['set-cookie']);
  const cookie = `sgs_at=${c.sgs_at ?? ''}`;
  return { cookie, userId: MeResponse.parse(res.body).user.id };
}

const patch = (cookie: string, body: object) =>
  request(app).patch('/api/v1/me').set(CSRF).set('Cookie', cookie).send(body);
const myStores = async (cookie: string) =>
  MyStoresResponse.parse(
    (await request(app).get('/api/v1/me/stores').set('Cookie', cookie).expect(200)).body,
  );

describe('PATCH /me', () => {
  it('sets the home from a DFW ZIP centroid', async () => {
    const { cookie } = await signUp();
    const res = await patch(cookie, {
      homeZip: '75034',
      vehicleMpg: 28.5,
      displayName: 'Frisco Family',
    }).expect(200);
    const user = MeResponse.parse(res.body).user;
    expect(user).toMatchObject({
      homeZip: '75034',
      vehicleMpg: 28.5,
      displayName: 'Frisco Family',
      onboarded: false,
    });
    expect(user.home?.lat).toBeCloseTo(33.121286, 5);
  });

  it('rejects ZIPs outside the DFW service area with 422', async () => {
    const { cookie } = await signUp();
    const res = await patch(cookie, { homeZip: '10001' }).expect(422);
    expect(ErrorResponse.parse(res.body).error.message).toMatch(/Dallas–Fort Worth/);
  });

  it('rejects unknown fields and bad values with 400', async () => {
    const { cookie } = await signUp();
    await patch(cookie, { email: 'hijack@example.com' }).expect(400);
    await patch(cookie, { vehicleMpg: -3 }).expect(400);
  });

  it('cannot finish onboarding without a home; can once the ZIP is set', async () => {
    const { cookie } = await signUp();
    await patch(cookie, { completeOnboarding: true }).expect(422);
    const res = await patch(cookie, { homeZip: '75024', completeOnboarding: true }).expect(200);
    expect(MeResponse.parse(res.body).user.onboarded).toBe(true);
  });

  it('validates the baseline (usual) store', async () => {
    const { cookie } = await signUp();
    const stores = StoresResponse.parse(
      (await request(app).get('/api/v1/stores').expect(200)).body,
    ).stores;
    const kroger = stores.find((s) => s.slug === 'kroger');
    await patch(cookie, { baselineStoreId: 999 }).expect(422);
    const res = await patch(cookie, { baselineStoreId: kroger?.id ?? 0 }).expect(200);
    expect(MeResponse.parse(res.body).user.baselineStoreId).toBe(kroger?.id);
  });
});

describe('GET /me/stores — pre-selection (SPEC §2.7)', () => {
  it('suggests chains within 7 mi of the home; loyalty cards on, memberships off, nothing saved yet', async () => {
    const { cookie } = await signUp();
    await patch(cookie, { homeZip: '75034' }).expect(200);
    const body = await myStores(cookie);
    expect(body.radiusMiles).toBe(7);
    expect(body.fallback).toBe(false);
    expect(body.stores).toHaveLength(10);
    for (const s of body.stores) {
      expect(s.saved).toBe(false);
      expect(s.enabled).toBe(s.preselected);
      expect(s.preselected).toBe((s.nearestLocation?.distanceMiles ?? Infinity) <= 7);
      expect(s.hasMembership).toBe(false);
      expect(s.hasLoyalty).toBe(s.loyaltyProgram !== null);
    }
    expect(body.stores.find((s) => s.slug === 'traderjoes')?.preselected).toBe(false);
    expect(body.stores.find((s) => s.slug === 'kroger')).toMatchObject({
      preselected: true,
      hasLoyalty: true,
      loyaltyProgram: 'Kroger Plus Card',
    });
  });

  it('a user at Main St & Preston Rd, Frisco gets every chain except Trader Joe’s', async () => {
    const { cookie, userId } = await signUp();
    await db.db
      .update(users)
      .set({ homeZip: '75034', homeLat: DEFAULT_ORIGIN.lat, homeLng: DEFAULT_ORIGIN.lng })
      .where(eq(users.id, userId));
    const body = await myStores(cookie);
    expect(
      body.stores
        .filter((s) => s.preselected)
        .map((s) => s.slug)
        .sort(),
    ).toEqual(
      [
        'aldi',
        'costco',
        'heb',
        'kroger',
        'sams',
        'sprouts',
        'target',
        'tomthumb',
        'walmart',
      ].sort(),
    );
  });

  it('falls back to the 3 nearest chains when none is within range', async () => {
    const { cookie } = await signUp();
    await patch(cookie, { homeZip: '76020' }).expect(200); // Azle, far west of the mock stores
    const body = await myStores(cookie);
    expect(body.fallback).toBe(true);
    expect(body.stores.filter((s) => s.preselected)).toHaveLength(3);
  });

  it('with no home yet, nothing is pre-selected', async () => {
    const { cookie } = await signUp();
    const body = await myStores(cookie);
    expect(
      body.stores.every((s) => !s.preselected && !s.enabled && s.nearestLocation === null),
    ).toBe(true);
  });
});

describe('PUT /me/stores', () => {
  it('saves settings and returns them', async () => {
    const { cookie } = await signUp();
    await patch(cookie, { homeZip: '75034' }).expect(200);
    const current = await myStores(cookie);
    const payload = current.stores.map((s) => ({
      storeId: s.id,
      enabled: s.slug !== 'target',
      hasMembership: s.slug === 'costco',
      hasLoyalty: s.slug === 'tomthumb',
      preferredLocationId: s.slug === 'kroger' ? (s.nearestLocation?.id ?? null) : null,
    }));
    const res = await request(app)
      .put('/api/v1/me/stores')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ stores: payload })
      .expect(200);
    const saved = MyStoresResponse.parse(res.body).stores;
    const by = (slug: string) => saved.find((s) => s.slug === slug);
    expect(saved.every((s) => s.saved)).toBe(true);
    expect(by('target')?.enabled).toBe(false);
    expect(by('costco')?.hasMembership).toBe(true);
    expect(by('kroger')).toMatchObject({
      hasLoyalty: false,
      preferredLocationId: by('kroger')?.nearestLocation?.id,
    });
    expect(by('tomthumb')?.hasLoyalty).toBe(true);
  });

  it('rejects impossible settings with 422 and field paths', async () => {
    const { cookie } = await signUp();
    const all = StoresResponse.parse((await request(app).get('/api/v1/stores')).body).stores;
    const id = (slug: string) => all.find((s) => s.slug === slug)?.id ?? 0;
    const costcoLoc =
      LocationsResponse.parse((await request(app).get('/api/v1/stores/costco/locations')).body)
        .locations[0]?.id ?? 0;
    const row = (slug: string, extra: object = {}) => ({
      storeId: id(slug),
      enabled: true,
      hasMembership: false,
      hasLoyalty: false,
      preferredLocationId: null,
      ...extra,
    });
    const res = await request(app)
      .put('/api/v1/me/stores')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({
        stores: [
          row('walmart', { hasMembership: true }),
          row('aldi', { hasLoyalty: true }),
          row('kroger', { preferredLocationId: costcoLoc }),
          { ...row('heb'), storeId: 999 },
        ],
      })
      .expect(422);
    const err = ErrorResponse.parse(res.body).error;
    expect(err.details).toHaveLength(4);
  });

  it('settings are private to each user', async () => {
    const a = await signUp();
    const b = await signUp();
    const all = StoresResponse.parse((await request(app).get('/api/v1/stores')).body).stores;
    await request(app)
      .put('/api/v1/me/stores')
      .set(CSRF)
      .set('Cookie', a.cookie)
      .send({
        stores: all.map((s) => ({
          storeId: s.id,
          enabled: false,
          hasMembership: false,
          hasLoyalty: false,
          preferredLocationId: null,
        })),
      })
      .expect(200);
    expect((await myStores(b.cookie)).stores.every((s) => !s.saved)).toBe(true);
  });
});

describe('public store endpoints', () => {
  it('lists the 10 chains in display order', async () => {
    const body = StoresResponse.parse((await request(app).get('/api/v1/stores').expect(200)).body);
    expect(body.stores.map((s) => s.slug)).toEqual([
      'walmart',
      'costco',
      'sams',
      'target',
      'kroger',
      'heb',
      'aldi',
      'tomthumb',
      'sprouts',
      'traderjoes',
    ]);
  });

  it('lists locations nearest-first', async () => {
    const res = await request(app)
      .get('/api/v1/stores/costco/locations?near=33.15,-96.8065')
      .expect(200);
    const d = LocationsResponse.parse(res.body).locations.map((l) => l.distanceMiles ?? -1);
    expect(d).toEqual([...d].sort((x, y) => x - y));
    await request(app).get('/api/v1/stores/nope/locations').expect(404);
    await request(app).get('/api/v1/stores/costco/locations?near=abc').expect(400);
  });
});
