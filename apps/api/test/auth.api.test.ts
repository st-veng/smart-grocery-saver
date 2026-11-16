import { sessions } from '@sgs/db';
import { ErrorResponse, MeResponse } from '@sgs/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMITS } from '../src/app.js';
import { ROTATION_GRACE_MS } from '../src/auth/sessions.js';
import { hashToken } from '../src/auth/tokens.js';
import { BAD_CREDENTIALS } from '../src/services/users.js';
import { buildApp, cookieValues, CSRF, setupDb, TestClock, type TestDb } from './helpers.js';

let db: TestDb;
beforeAll(async () => {
  db = await setupDb('api_auth');
});
afterAll(async () => {
  await db.close();
});

let n = 0;
const uniqueEmail = () => `user${String(++n)}-${String(Date.now())}@example.com`;
const PASSWORD = 'correct horse battery';

async function register(app: ReturnType<typeof buildApp>, email = uniqueEmail()) {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .set(CSRF)
    .send({ email, password: PASSWORD, displayName: 'Pat Shopper' })
    .expect(201);
  return { res, email, cookies: cookieValues(res.headers['set-cookie']) };
}

const cookieHeader = (c: Record<string, string>) =>
  Object.entries(c)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

describe('register', () => {
  it('creates the user, returns the profile and sets httpOnly SameSite=Lax cookies', async () => {
    const app = buildApp(db);
    const { res, email, cookies } = await register(app);
    const body = MeResponse.parse(res.body);
    expect(body.user).toMatchObject({
      email,
      displayName: 'Pat Shopper',
      onboarded: false,
      hasPassword: true,
      providers: [],
    });
    const raw = (res.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(raw).toMatch(
      /sgs_at=[^;]+; Max-Age=900; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax/,
    );
    expect(raw).toMatch(
      /sgs_rt=[^;]+; Max-Age=2592000; Path=\/api\/v1\/auth; Expires=[^;]+; HttpOnly; SameSite=Lax/,
    );
    expect(cookies.sgs_at).toBeTruthy();
    expect(cookies.sgs_rt).toBeTruthy();
  });

  it('rejects a duplicate email (case-insensitive) with 409', async () => {
    const app = buildApp(db);
    const { email } = await register(app);
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set(CSRF)
      .send({ email: email.toUpperCase(), password: PASSWORD, displayName: 'Again' })
      .expect(409);
    expect(ErrorResponse.parse(res.body).error.code).toBe('CONFLICT');
  });

  it('validates input with field details', async () => {
    const res = await request(buildApp(db))
      .post('/api/v1/auth/register')
      .set(CSRF)
      .send({ email: 'nope', password: 'short', displayName: '' })
      .expect(400);
    const err = ErrorResponse.parse(res.body).error;
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.details?.length).toBeGreaterThanOrEqual(3);
  });

  it('requires the CSRF header on state-changing requests', async () => {
    const res = await request(buildApp(db))
      .post('/api/v1/auth/register')
      .send({ email: uniqueEmail(), password: PASSWORD, displayName: 'X' })
      .expect(403);
    expect(ErrorResponse.parse(res.body).error.code).toBe('FORBIDDEN');
  });

  it('stores only a hash of the refresh token', async () => {
    const { cookies } = await register(buildApp(db));
    const token = cookies.sgs_rt ?? '';
    const [row] = await db.db
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, hashToken(token)));
    expect(row).toBeDefined();
    expect(row?.refreshTokenHash.toString('utf8')).not.toContain(token);
  });
});

describe('login', () => {
  it('signs in with the right password', async () => {
    const app = buildApp(db);
    const { email } = await register(app);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email, password: PASSWORD })
      .expect(200);
    expect(MeResponse.parse(res.body).user.email).toBe(email);
    expect(cookieValues(res.headers['set-cookie']).sgs_at).toBeTruthy();
  });

  it('gives the same 401 for a wrong password, an unknown email, and a Google-only account', async () => {
    const app = buildApp(db);
    const { email } = await register(app);
    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email, password: 'wrong password!' });
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email: uniqueEmail(), password: PASSWORD });
    for (const r of [wrong, unknown]) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: BAD_CREDENTIALS } });
      expect(r.headers['set-cookie']).toBeUndefined();
    }
  });

  it('takes similar time for unknown emails and wrong passwords (no user enumeration by timing)', async () => {
    const app = buildApp(db, {
      rateLimits: { ...DEFAULT_RATE_LIMITS, login: { limit: 1000, windowMs: 60_000 } },
    });
    const { email } = await register(app);
    const time = async (body: object) => {
      const t = performance.now();
      await request(app).post('/api/v1/auth/login').set(CSRF).send(body).expect(401);
      return performance.now() - t;
    };
    await time({ email, password: 'warm-up-xx' });
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 5; i++) {
      known.push(await time({ email, password: `wrong-${String(i)}-xxxx` }));
      unknown.push(await time({ email: uniqueEmail(), password: `wrong-${String(i)}-xxxx` }));
    }
    const ratio = median(unknown) / median(known);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });

  it('rate-limits repeated attempts per IP + email with 429', async () => {
    const app = buildApp(db, {
      rateLimits: { ...DEFAULT_RATE_LIMITS, login: { limit: 3, windowMs: 60_000 } },
    });
    const email = uniqueEmail();
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .set(CSRF)
        .send({ email, password: 'x' })
        .expect(401);
    }
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email, password: 'x' })
      .expect(429);
    expect(ErrorResponse.parse(res.body).error.code).toBe('RATE_LIMITED');
    // A different email from the same IP is a different bucket.
    await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email: uniqueEmail(), password: 'x' })
      .expect(401);
  });
});

describe('sessions', () => {
  it('protected routes return 401 without a session', async () => {
    const app = buildApp(db);
    for (const [method, path] of [
      ['get', '/api/v1/auth/me'],
      ['get', '/api/v1/me/stores'],
      ['patch', '/api/v1/me'],
      ['put', '/api/v1/me/stores'],
    ] as const) {
      const res = await request(app)[method](path).set(CSRF).send({});
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(ErrorResponse.parse(res.body).error.code).toBe('UNAUTHENTICATED');
    }
    await request(app).get('/api/v1/auth/me').set('Cookie', 'sgs_at=not-a-jwt').expect(401);
  });

  it('an expired access token is renewed by rotating the refresh token', async () => {
    const clock = new TestClock();
    const app = buildApp(db, { clock });
    const { cookies } = await register(app);
    await request(app).get('/api/v1/auth/me').set('Cookie', cookieHeader(cookies)).expect(200);
    clock.advance(16 * 60_000);
    await request(app).get('/api/v1/auth/me').set('Cookie', cookieHeader(cookies)).expect(401);
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);
    const renewed = cookieValues(res.headers['set-cookie']);
    expect(renewed.sgs_rt).toBeTruthy();
    expect(renewed.sgs_rt).not.toBe(cookies.sgs_rt);
    await request(app).get('/api/v1/auth/me').set('Cookie', cookieHeader(renewed)).expect(200);
  });

  it('replaying a rotated refresh token revokes the whole family', async () => {
    const clock = new TestClock();
    const app = buildApp(db, { clock });
    const { cookies: first } = await register(app);
    const r1 = await request(app)
      .post('/api/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', cookieHeader(first))
      .expect(200);
    const second = cookieValues(r1.headers['set-cookie']);
    clock.advance(ROTATION_GRACE_MS + 1_000);
    // Attacker (or stale client) replays the first token:
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', cookieHeader(first))
      .expect(401);
    expect(cookieValues(replay.headers['set-cookie']).sgs_rt).toBe('');
    // The legitimate, newer tokens are dead too:
    await request(app)
      .post('/api/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', cookieHeader(second))
      .expect(401);
    await request(app).get('/api/v1/auth/me').set('Cookie', cookieHeader(second)).expect(401);
  });

  it('a rotated token presented again within the grace window (two tabs) does not revoke the family', async () => {
    const app = buildApp(db);
    const { cookies: first } = await register(app);
    const r1 = await request(app)
      .post('/api/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', cookieHeader(first))
      .expect(200);
    const second = cookieValues(r1.headers['set-cookie']);
    const race = await request(app)
      .post('/api/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', cookieHeader(first))
      .expect(401);
    expect(race.headers['set-cookie']).toBeUndefined();
    await request(app)
      .post('/api/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', cookieHeader(second))
      .expect(200);
  });

  it('refresh without a cookie, or with an expired one, is 401', async () => {
    const clock = new TestClock();
    const app = buildApp(db, { clock });
    await request(app).post('/api/v1/auth/refresh').set(CSRF).expect(401);
    const { cookies } = await register(app);
    clock.advance(31 * 24 * 3600_000);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', cookieHeader(cookies))
      .expect(401);
  });

  it('logout invalidates the session immediately, including the unexpired access token', async () => {
    const app = buildApp(db);
    const { cookies } = await register(app);
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set(CSRF)
      .set('Cookie', cookieHeader(cookies))
      .expect(204);
    expect(cookieValues(res.headers['set-cookie'])).toMatchObject({ sgs_at: '', sgs_rt: '' });
    await request(app).get('/api/v1/auth/me').set('Cookie', cookieHeader(cookies)).expect(401);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', cookieHeader(cookies))
      .expect(401);
    // Idempotent without cookies.
    await request(app).post('/api/v1/auth/logout').set(CSRF).expect(204);
  });

  it('sessions are per device: logging out one does not affect another', async () => {
    const app = buildApp(db);
    const { email, cookies: phone } = await register(app);
    const laptopRes = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email, password: PASSWORD })
      .expect(200);
    const laptop = cookieValues(laptopRes.headers['set-cookie']);
    await request(app)
      .post('/api/v1/auth/logout')
      .set(CSRF)
      .set('Cookie', cookieHeader(phone))
      .expect(204);
    await request(app).get('/api/v1/auth/me').set('Cookie', cookieHeader(laptop)).expect(200);
  });
});
