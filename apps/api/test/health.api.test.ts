import { type PriceProvider } from '@sgs/pricing';
import { ErrorResponse, HealthResponse, ReadyResponse } from '@sgs/shared';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Queryable } from '../src/app.js';
import {
  buildApp,
  provider,
  setupDb,
  TestClock,
  type AppOverrides,
  type TestDb,
} from './helpers.js';

let db: TestDb;

function app(overrides: AppOverrides = {}) {
  const clock = new TestClock();
  clock.now = new Date('2026-11-01T12:01:30Z');
  return buildApp(db, { clock, ...overrides });
}

beforeAll(async () => {
  db = await setupDb('api_health');
});
afterAll(async () => {
  await db.close();
});

describe('GET /api/v1/health', () => {
  it('returns liveness with version and uptime from the injected clock', async () => {
    const res = await request(app())
      .get('/api/v1/health')
      .expect(200)
      .expect('content-type', /json/);
    expect(HealthResponse.parse(res.body)).toEqual({
      status: 'ok',
      version: '0.1.0-test',
      uptimeS: 90,
    });
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app()).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('GET /api/v1/health/ready', () => {
  it('is ready when the DB is reachable, migrated, and the provider is healthy', async () => {
    const res = await request(app()).get('/api/v1/health/ready').expect(200);
    const body = ReadyResponse.parse(res.body);
    expect(body.status).toBe('ready');
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.migrations).toMatchObject({ ok: true, applied: 2 });
    expect(body.checks.provider).toMatchObject({ ok: true, id: 'mock' });
    expect(body).toMatchObject({ priceProvider: 'mock', metro: 'DFW' });
  });

  it('returns 503 when the database is down, without leaking a stack trace', async () => {
    const down: Queryable = {
      query: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5433')),
    };
    const res = await request(app({ pool: down }))
      .get('/api/v1/health/ready')
      .expect(503);
    const body = ReadyResponse.parse(res.body);
    expect(body.status).toBe('not_ready');
    expect(body.checks.database).toEqual({
      ok: false,
      detail: 'connect ECONNREFUSED 127.0.0.1:5433',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+/);
  });

  it('returns 503 when the provider is unhealthy', async () => {
    const sick: PriceProvider = {
      id: 'mock',
      listStores: (m) => provider.listStores(m),
      listLocations: (s, m) => provider.listLocations(s, m),
      listItems: (s, c) => provider.listItems(s, c),
      getPrices: (q) => provider.getPrices(q),
      health: () => Promise.resolve({ ok: false, detail: 'feed stale' }),
    };
    const res = await request(app({ provider: sick }))
      .get('/api/v1/health/ready')
      .expect(503);
    expect(ReadyResponse.parse(res.body).checks.provider).toEqual({
      ok: false,
      detail: 'feed stale',
      id: 'mock',
    });
  });
});

describe('errors', () => {
  it('unknown routes return the standard 404 error shape', async () => {
    const res = await request(app()).get('/api/v1/nope').expect(404);
    expect(ErrorResponse.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('malformed JSON returns 400 VALIDATION_FAILED', async () => {
    const res = await request(app())
      .post('/api/v1/health')
      .set('content-type', 'application/json')
      .send('{"bad json')
      .expect(400);
    expect(ErrorResponse.parse(res.body).error.code).toBe('VALIDATION_FAILED');
  });

  it('unexpected errors are logged and return a generic 500', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'error' }, { write: (l: string) => void lines.push(l) });
    const boom: Queryable = {
      query: () => {
        throw new Error('secret SQL detail');
      },
    };
    // The ready route catches check failures, so trigger a crash in the liveness clock instead.
    const res = await request(
      app({
        logger,
        pool: boom,
        clock: () => {
          throw new Error('secret SQL detail');
        },
      }),
    )
      .get('/api/v1/health')
      .expect(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
    expect(lines.join('')).toContain('secret SQL detail');
  });
});
