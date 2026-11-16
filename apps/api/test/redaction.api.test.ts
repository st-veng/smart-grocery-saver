import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, cookieValues, CSRF, setupDb, type TestDb } from './helpers.js';

let db: TestDb;
beforeAll(async () => {
  db = await setupDb('api_redaction');
});
afterAll(async () => {
  await db.close();
});

describe('no secrets in responses or logs', () => {
  it('never logs or returns passwords, password hashes or tokens', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'trace' }, { write: (l: string) => void lines.push(l) });
    const app = buildApp(db, { logger });
    const password = 'super secret password 42';
    const email = 'secret@example.com';

    const reg = await request(app)
      .post('/api/v1/auth/register')
      .set(CSRF)
      .send({ email, password, displayName: 'S' })
      .expect(201);
    const c1 = cookieValues(reg.headers['set-cookie']);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email, password })
      .expect(200);
    const c2 = cookieValues(login.headers['set-cookie']);
    const cookie = `sgs_at=${c2.sgs_at ?? ''}; sgs_rt=${c2.sgs_rt ?? ''}`;
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', cookie)
      .expect(200);
    const c3 = cookieValues(refresh.headers['set-cookie']);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', `sgs_at=${c3.sgs_at ?? ''}`)
      .expect(200);
    await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email, password: 'wrong guess!!' })
      .expect(401);

    const secrets = [
      password,
      'wrong guess!!',
      ...[c1, c2, c3].flatMap((c) => [c.sgs_at ?? '', c.sgs_rt ?? '']),
    ].filter(Boolean);
    const logs = lines.join('\n');
    const bodies = JSON.stringify([reg.body, login.body, refresh.body]);
    expect(lines.length).toBeGreaterThan(3);
    for (const s of secrets) {
      expect(logs).not.toContain(s);
      expect(bodies).not.toContain(s);
    }
    expect(logs).not.toContain('$argon2');
    expect(bodies).not.toContain('$argon2');
    expect(bodies).not.toMatch(/"password"|passwordHash|password_hash/i);
    expect(logs).toContain('[Redacted]');
  });
});
