import request from 'supertest';
import { createTestDatabase } from '@sgs/db/testing';
import { MockPriceProvider, seedCatalog, seedSystemTemplates, syncStores } from '@sgs/pricing';
import { pino, type Logger } from 'pino';
import { createApp, type AppDeps } from '../src/app.js';
import type { RateLimits } from '../src/auth/middleware.js';
import { MockGoogleClient } from '../src/auth/google.js';
import { TokenService } from '../src/auth/tokens.js';

export type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
export const CSRF = { 'X-Requested-With': 'sgs' } as const;
export const WEB_ORIGIN = 'http://web.test';
export const provider = new MockPriceProvider({ seed: '20261116', anchorDate: '2026-11-01' });

const big = { limit: 10_000, windowMs: 60_000 };
/** Tests that exercise rate limiting pass their own limits. */
export const GENEROUS_LIMITS: RateLimits = { login: big, register: big, refresh: big, google: big };

/** A settable clock shared by the app and the token service. */
export class TestClock {
  now = new Date('2026-11-01T12:00:00Z');
  readonly fn = () => this.now;
  advance(ms: number): void {
    this.now = new Date(this.now.getTime() + ms);
  }
}

/** Fresh migrated DB with the 10 stores + 40 mock locations (no prices needed for auth/profile). */
export async function setupDb(suffix: string): Promise<TestDb> {
  const db = await createTestDatabase(suffix);
  await syncStores(db.db, provider, 'DFW');
  return db;
}

export type AppOverrides = Omit<Partial<AppDeps>, 'clock'> & {
  clock?: TestClock | (() => Date);
  logger?: Logger;
};

/** Stores + catalog (categories, products, aliases) + system templates — enough for lists and import. */
export async function setupCatalogDb(suffix: string): Promise<TestDb> {
  const db = await setupDb(suffix);
  await seedCatalog(db.db);
  await seedSystemTemplates(db.db, new Date('2026-11-01T12:00:00Z'));
  return db;
}

/** Register a user and return a Cookie header for it. */
export async function signUp(
  app: ReturnType<typeof buildApp>,
  label = 'u',
): Promise<{ cookie: string; userId: string }> {
  const email = `${label}-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request(app)
    .post('/api/v1/auth/register')
    .set(CSRF)
    .send({ email, password: 'correct horse battery', displayName: label });
  if (res.status !== 201) throw new Error(`signUp failed: ${String(res.status)}`);
  const c = cookieValues(res.headers['set-cookie']);
  return {
    cookie: `sgs_at=${c.sgs_at ?? ''}`,
    userId: (res.body as { user: { id: string } }).user.id,
  };
}

export function buildApp(db: TestDb, overrides: AppOverrides = {}) {
  const { clock: given, ...rest } = overrides;
  const clockFn = typeof given === 'function' ? given : (given ?? new TestClock()).fn;
  return createApp({
    pool: db.pool,
    db: db.db,
    provider,
    tokens: new TokenService('test-secret-test-secret-test-secret-123', clockFn),
    google: new MockGoogleClient(),
    config: {
      webOrigin: WEB_ORIGIN,
      cookieSecure: false,
      preselectRadiusMiles: 7,
      defaultOrigin: { lat: 33.15, lng: -96.8065 },
    },
    rateLimits: GENEROUS_LIMITS,
    metro: 'DFW',
    version: '0.1.0-test',
    startedAt: new Date('2026-11-01T12:00:00Z'),
    clock: clockFn,
    logger: pino({ level: 'silent' }),
    ...rest,
  });
}

/** Extract `name=value` pairs from Set-Cookie headers. */
export function cookieValues(setCookie: string[] | string | undefined): Record<string, string> {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const out: Record<string, string> = {};
  for (const c of list) {
    const [pair] = c.split(';');
    const i = pair?.indexOf('=') ?? -1;
    if (pair && i > 0) out[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
  }
  return out;
}
