import { LoginRequest, RegisterRequest, type MeResponse } from '@sgs/shared';
import { Router, type Request, type Response } from 'express';
import type { AppDeps } from '../app.js';
import {
  clearAuthCookies,
  clearOAuthCookie,
  OAUTH_COOKIE,
  readCookie,
  REFRESH_COOKIE,
  setAuthCookies,
  setOAuthCookie,
} from '../auth/cookies.js';
import { GoogleAuthError, MockGoogleClient } from '../auth/google.js';
import { auth, limiter, requireAuth } from '../auth/middleware.js';
import {
  createSession,
  familyOfRefreshToken,
  revokeFamily,
  rotateSession,
  type SessionMeta,
} from '../auth/sessions.js';
import { pkceChallenge, randomToken, safeReturnTo } from '../auth/tokens.js';
import { AppError } from '../errors.js';
import {
  authenticate,
  findUser,
  loginWithGoogle,
  registerUser,
  toUserDto,
} from '../services/users.js';
import { parse } from '../validate.js';

const meta = (req: Request): SessionMeta => ({
  userAgent: req.get('user-agent') ?? null,
  ip: req.ip ?? null,
});

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

export function authRouter(deps: AppDeps): Router {
  const r = Router();
  const { db, tokens, config } = deps;
  const secure = config.cookieSecure;

  async function startSession(req: Request, res: Response, userId: string): Promise<void> {
    const s = await createSession(db, userId, deps.clock(), meta(req));
    setAuthCookies(
      res,
      secure,
      await tokens.signAccess({ userId, sessionId: s.sessionId }),
      s.refreshToken,
    );
  }

  async function sendMe(res: Response, userId: string, status = 200): Promise<void> {
    const user = await findUser(db, userId);
    if (!user) throw new AppError('UNAUTHENTICATED', 401, 'Not signed in');
    const body: MeResponse = { user: await toUserDto(db, user) };
    res.status(status).json(body);
  }

  r.post('/register', limiter(deps.rateLimits.register), async (req, res) => {
    const input = parse(RegisterRequest, req.body);
    const user = await registerUser(db, input, deps.clock());
    await startSession(req, res, user.id);
    await sendMe(res, user.id, 201);
  });

  r.post('/login', limiter(deps.rateLimits.login, true), async (req, res) => {
    const input = parse(LoginRequest, req.body);
    const user = await authenticate(db, input.email, input.password);
    await startSession(req, res, user.id);
    await sendMe(res, user.id);
  });

  r.post('/refresh', limiter(deps.rateLimits.refresh), async (req, res) => {
    const token = readCookie(req.cookies, REFRESH_COOKIE);
    if (!token) throw new AppError('UNAUTHENTICATED', 401, 'Not signed in');
    const result = await rotateSession(db, token, deps.clock(), meta(req));
    if (result.kind !== 'ok') {
      if (result.kind === 'reuse') {
        deps.logger?.warn(
          { familyId: result.familyId },
          'refresh token reuse detected; session family revoked',
        );
      }
      // A 'race' (another tab rotated a moment ago) keeps the cookies the other tab just received.
      if (result.kind !== 'race') clearAuthCookies(res, secure);
      throw new AppError('UNAUTHENTICATED', 401, 'Session expired. Please sign in again.');
    }
    const s = result.session;
    setAuthCookies(
      res,
      secure,
      await tokens.signAccess({ userId: s.userId, sessionId: s.sessionId }),
      s.refreshToken,
    );
    await sendMe(res, s.userId);
  });

  r.post('/logout', async (req, res) => {
    const refresh = readCookie(req.cookies, REFRESH_COOKIE);
    const family = refresh ? await familyOfRefreshToken(db, refresh) : null;
    if (family) await revokeFamily(db, family, deps.clock());
    clearAuthCookies(res, secure);
    res.status(204).end();
  });

  r.get('/me', requireAuth(db, tokens), async (_req, res) => {
    await sendMe(res, auth(res).userId);
  });

  // ───────────── Google (OIDC + PKCE; mock consent screen when no credentials) ─────────────
  const loginError = (reason: string) =>
    `${config.webOrigin}/login?error=${encodeURIComponent(reason)}`;

  r.get('/google', limiter(deps.rateLimits.google), async (req, res) => {
    const state = randomToken(24);
    const codeVerifier = randomToken(48);
    const nonce = randomToken(24);
    const returnTo = safeReturnTo(req.query.returnTo);
    setOAuthCookie(
      res,
      secure,
      await tokens.signOAuthState({ state, codeVerifier, nonce, returnTo }),
    );
    res.redirect(
      302,
      deps.google.authorizationUrl({ state, nonce, codeChallenge: pkceChallenge(codeVerifier) }),
    );
  });

  r.get('/google/callback', async (req, res) => {
    const cookie = readCookie(req.cookies, OAUTH_COOKIE);
    const saved = cookie ? await tokens.verifyOAuthState(cookie) : null;
    clearOAuthCookie(res, secure);
    const { code, state, error } = req.query;
    if (typeof error === 'string') {
      res.redirect(302, loginError(error === 'access_denied' ? 'google_cancelled' : 'google'));
      return;
    }
    if (!saved || typeof state !== 'string' || state !== saved.state || typeof code !== 'string') {
      res.redirect(302, loginError('google_state'));
      return;
    }
    try {
      const identity = await deps.google.exchange({
        code,
        codeVerifier: saved.codeVerifier,
        nonce: saved.nonce,
      });
      const { user, outcome } = await loginWithGoogle(db, identity, deps.clock());
      deps.logger?.info({ userId: user.id, outcome }, 'google sign-in');
      await startSession(req, res, user.id);
      res.redirect(302, `${config.webOrigin}${saved.returnTo}`);
    } catch (e) {
      if (e instanceof GoogleAuthError) {
        deps.logger?.warn({ reason: e.message }, 'google sign-in rejected');
        res.redirect(302, loginError('google'));
        return;
      }
      if (e instanceof AppError && e.code === 'FORBIDDEN') {
        res.redirect(302, loginError('google_unverified'));
        return;
      }
      throw e;
    }
  });

  if (deps.google.mode === 'mock') {
    r.get('/google/mock', (req, res) => {
      const q = (k: string) => (typeof req.query[k] === 'string' ? req.query[k] : '');
      const hidden = ['state', 'nonce', 'code_challenge']
        .map((k) => `<input type="hidden" name="${k}" value="${escapeHtml(q(k))}">`)
        .join('');
      res.type('html')
        .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mock Google sign-in</title></head>
<body style="font-family:system-ui,sans-serif;max-width:28rem;margin:2rem auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.25rem">Mock Google sign-in</h1>
<p>Development only. No Google credentials are configured, so this page stands in for Google's consent screen.</p>
<form method="post" action="/api/v1/auth/google/mock/consent">${hidden}
<p><label>Email<br><input name="email" type="email" required autocomplete="off" style="width:100%;padding:.5rem;font-size:1rem"></label></p>
<p><label>Name<br><input name="name" style="width:100%;padding:.5rem;font-size:1rem" autocomplete="off"></label></p>
<p><label><input type="checkbox" name="email_verified" value="true" checked> Email is verified</label></p>
<p><button type="submit" style="padding:.6rem 1.2rem;font-size:1rem">Continue</button></p>
</form></body></html>`);
    });

    r.post('/google/mock/consent', (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const s = (k: string) => (typeof b[k] === 'string' ? b[k] : '');
      const email = s('email').trim().toLowerCase();
      if (!email.includes('@')) throw new AppError('VALIDATION_FAILED', 400, 'Enter an email');
      const code = MockGoogleClient.encodeCode({
        sub: `mock-${email}`,
        email,
        emailVerified: s('email_verified') === 'true',
        name: s('name').trim() || null,
        nonce: s('nonce'),
        codeChallenge: s('code_challenge'),
      });
      const q = new URLSearchParams({ code, state: s('state') });
      res.redirect(302, `/api/v1/auth/google/callback?${q.toString()}`);
    });
  }

  return r;
}
