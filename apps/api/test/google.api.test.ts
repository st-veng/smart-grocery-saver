import { authIdentities, users } from '@sgs/db';
import { MeResponse } from '@sgs/shared';
import { eq } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GoogleAuthError, RealGoogleClient } from '../src/auth/google.js';
import { pkceChallenge } from '../src/auth/tokens.js';
import { buildApp, cookieValues, CSRF, setupDb, WEB_ORIGIN, type TestDb } from './helpers.js';

let db: TestDb;
beforeAll(async () => {
  db = await setupDb('api_google');
});
afterAll(async () => {
  await db.close();
});

const header = (c: Record<string, string>) =>
  Object.entries(c)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

/** Drive the whole mock Google flow like a browser would. Returns the final redirect + cookies. */
async function googleSignIn(
  app: ReturnType<typeof buildApp>,
  identity: { email: string; name?: string; verified?: boolean },
  returnTo = '/',
) {
  const start = await request(app)
    .get(`/api/v1/auth/google?returnTo=${encodeURIComponent(returnTo)}`)
    .expect(302);
  const oauthCookie = cookieValues(start.headers['set-cookie']);
  const consentUrl = new URL(start.headers.location ?? '', 'http://api.test');
  expect(consentUrl.pathname).toBe('/api/v1/auth/google/mock');
  const page = await request(app)
    .get(consentUrl.pathname + consentUrl.search)
    .expect(200);
  expect(page.text).toContain('Mock Google sign-in');
  const form = {
    state: consentUrl.searchParams.get('state') ?? '',
    nonce: consentUrl.searchParams.get('nonce') ?? '',
    code_challenge: consentUrl.searchParams.get('code_challenge') ?? '',
    email: identity.email,
    name: identity.name ?? '',
    ...(identity.verified === false ? {} : { email_verified: 'true' }),
  };
  // A plain HTML form post: no CSRF header, by design.
  const consent = await request(app)
    .post('/api/v1/auth/google/mock/consent')
    .type('form')
    .send(form)
    .expect(302);
  const cb = await request(app)
    .get(consent.headers.location ?? '')
    .set('Cookie', header(oauthCookie))
    .expect(302);
  return { location: cb.headers.location ?? '', cookies: cookieValues(cb.headers['set-cookie']) };
}

describe('Google sign-in (mock mode)', () => {
  it('creates a user on first sign-in and redirects to the requested page', async () => {
    const app = buildApp(db);
    const { location, cookies } = await googleSignIn(
      app,
      { email: 'gwen@example.com', name: 'Gwen G' },
      '/compare',
    );
    expect(location).toBe(`${WEB_ORIGIN}/compare`);
    const me = await request(app).get('/api/v1/auth/me').set('Cookie', header(cookies)).expect(200);
    expect(MeResponse.parse(me.body).user).toMatchObject({
      email: 'gwen@example.com',
      displayName: 'Gwen G',
      hasPassword: false,
      providers: ['google'],
    });
  });

  it('the second sign-in reuses the account instead of duplicating it', async () => {
    const app = buildApp(db);
    await googleSignIn(app, { email: 'twice@example.com' });
    const { cookies } = await googleSignIn(app, { email: 'twice@example.com' });
    expect(cookies.sgs_at).toBeTruthy();
    const rows = await db.db.select().from(users).where(eq(users.email, 'twice@example.com'));
    expect(rows).toHaveLength(1);
    const ids = await db.db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, rows[0]?.id ?? ''));
    expect(ids).toHaveLength(1);
  });

  it('links to an existing email/password account when the Google email is verified', async () => {
    const app = buildApp(db);
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .set(CSRF)
      .send({ email: 'link@example.com', password: 'correct horse battery', displayName: 'Lin' })
      .expect(201);
    const before = MeResponse.parse(reg.body).user;
    const { cookies } = await googleSignIn(app, { email: 'LINK@example.com' });
    const me = MeResponse.parse(
      (await request(app).get('/api/v1/auth/me').set('Cookie', header(cookies))).body,
    ).user;
    expect(me.id).toBe(before.id);
    expect(me).toMatchObject({ hasPassword: true, providers: ['google'], displayName: 'Lin' });
    // Password login still works after linking.
    await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email: 'link@example.com', password: 'correct horse battery' })
      .expect(200);
  });

  it('refuses an unverified Google email and creates nothing', async () => {
    const app = buildApp(db);
    const { location, cookies } = await googleSignIn(app, {
      email: 'unverified@example.com',
      verified: false,
    });
    expect(location).toBe(`${WEB_ORIGIN}/login?error=google_unverified`);
    expect(cookies.sgs_at).toBeUndefined();
    expect(
      await db.db.select().from(users).where(eq(users.email, 'unverified@example.com')),
    ).toHaveLength(0);
  });

  it('rejects a callback whose state does not match the signed cookie', async () => {
    const app = buildApp(db);
    const start = await request(app).get('/api/v1/auth/google').expect(302);
    const res = await request(app)
      .get('/api/v1/auth/google/callback?code=mock.x&state=forged')
      .set('Cookie', header(cookieValues(start.headers['set-cookie'])))
      .expect(302);
    expect(res.headers.location).toBe(`${WEB_ORIGIN}/login?error=google_state`);
    const noCookie = await request(app)
      .get('/api/v1/auth/google/callback?code=mock.x&state=x')
      .expect(302);
    expect(noCookie.headers.location).toBe(`${WEB_ORIGIN}/login?error=google_state`);
  });

  it('never redirects off-site (open-redirect guard)', async () => {
    const app = buildApp(db);
    for (const evil of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
      const { location } = await googleSignIn(app, { email: 'safe@example.com' }, evil);
      expect(location).toBe(`${WEB_ORIGIN}/`);
    }
  });

  it('a user cancelling at Google lands back on login with a reason', async () => {
    const res = await request(buildApp(db))
      .get('/api/v1/auth/google/callback?error=access_denied')
      .expect(302);
    expect(res.headers.location).toBe(`${WEB_ORIGIN}/login?error=google_cancelled`);
  });
});

describe('RealGoogleClient (OIDC + PKCE) against a local fake issuer', () => {
  const clientId = 'client-123.apps.googleusercontent.com';

  async function fakeGoogle(claims: Record<string, unknown>) {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    const idToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer('https://accounts.google.com')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    const calls: URLSearchParams[] = [];
    const client = new RealGoogleClient({
      clientId,
      clientSecret: 'secret',
      redirectUri: 'http://localhost:4000/api/v1/auth/google/callback',
      jwks: createLocalJWKSet({ keys: [jwk] }),
      fetch: (_url, init) => {
        calls.push(init?.body instanceof URLSearchParams ? init.body : new URLSearchParams());
        return Promise.resolve(
          new Response(JSON.stringify({ id_token: idToken }), { status: 200 }),
        );
      },
    });
    return { client, calls };
  }

  it('builds an authorization URL with PKCE S256, state and nonce', () => {
    const client = new RealGoogleClient({
      clientId,
      clientSecret: 's',
      redirectUri: 'http://x/cb',
    });
    const url = new URL(
      client.authorizationUrl({
        state: 'st',
        nonce: 'no',
        codeChallenge: pkceChallenge('verifier'),
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: clientId,
      response_type: 'code',
      scope: 'openid email profile',
      state: 'st',
      nonce: 'no',
      code_challenge: pkceChallenge('verifier'),
      code_challenge_method: 'S256',
    });
  });

  it('exchanges the code with the verifier and verifies the id_token', async () => {
    const { client, calls } = await fakeGoogle({
      sub: 'g-1',
      email: 'Real@Example.com',
      email_verified: true,
      name: 'Real',
      aud: clientId,
      nonce: 'n1',
    });
    const id = await client.exchange({ code: 'abc', codeVerifier: 'ver', nonce: 'n1' });
    expect(id).toEqual({
      sub: 'g-1',
      email: 'real@example.com',
      emailVerified: true,
      name: 'Real',
    });
    expect(calls[0]?.get('code_verifier')).toBe('ver');
    expect(calls[0]?.get('grant_type')).toBe('authorization_code');
  });

  it('rejects a nonce mismatch and a token for another audience', async () => {
    const a = await fakeGoogle({
      sub: 'g',
      email: 'a@b.c',
      email_verified: true,
      aud: clientId,
      nonce: 'other',
    });
    await expect(a.client.exchange({ code: 'c', codeVerifier: 'v', nonce: 'n1' })).rejects.toThrow(
      GoogleAuthError,
    );
    const b = await fakeGoogle({
      sub: 'g',
      email: 'a@b.c',
      email_verified: true,
      aud: 'someone-else',
      nonce: 'n1',
    });
    await expect(b.client.exchange({ code: 'c', codeVerifier: 'v', nonce: 'n1' })).rejects.toThrow(
      /invalid id_token/,
    );
  });
});
