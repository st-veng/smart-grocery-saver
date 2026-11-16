import type { Db } from '@sgs/db';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { AppError } from '../errors.js';
import { ACCESS_COOKIE, readCookie } from './cookies.js';
import { sessionUsable } from './sessions.js';
import type { TokenService } from './tokens.js';

export interface AuthContext {
  readonly userId: string;
  readonly sessionId: string;
  readonly familyId: string;
}

/** Set by requireAuth; read with `auth(res)`. */
export function auth(res: Response): AuthContext {
  const a = (res.locals as { auth?: AuthContext }).auth;
  if (!a) throw new AppError('UNAUTHENTICATED', 401, 'Not signed in');
  return a;
}

/** Valid access JWT + a session whose family has not been revoked (logout / token reuse). */
export function requireAuth(db: Db, tokens: TokenService): RequestHandler {
  return async (req, res, next) => {
    const token = readCookie(req.cookies, ACCESS_COOKIE);
    const claims = token ? await tokens.verifyAccess(token) : null;
    const session = claims ? await sessionUsable(db, claims.sessionId) : null;
    if (!claims || !session) {
      next(new AppError('UNAUTHENTICATED', 401, 'Not signed in'));
      return;
    }
    (res.locals as { auth?: AuthContext }).auth = { ...claims, familyId: session.familyId };
    next();
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Plain HTML form posts that cannot set custom headers; protected by the signed OAuth state instead. */
const CSRF_EXEMPT = new Set(['/api/v1/auth/google/mock/consent']);

/** CSRF defence (SPEC §3): SameSite=Lax cookies + a custom header that cross-site forms cannot send. */
export const csrfGuard: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  if (SAFE_METHODS.has(req.method) || CSRF_EXEMPT.has(req.baseUrl + req.path)) {
    next();
    return;
  }
  if (req.get('x-requested-with') !== 'sgs') {
    next(new AppError('FORBIDDEN', 403, 'Missing X-Requested-With header'));
    return;
  }
  next();
};

export interface RateLimits {
  readonly login: { readonly limit: number; readonly windowMs: number };
  readonly register: { readonly limit: number; readonly windowMs: number };
  readonly refresh: { readonly limit: number; readonly windowMs: number };
  readonly google: { readonly limit: number; readonly windowMs: number };
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  login: { limit: 10, windowMs: 15 * 60_000 },
  register: { limit: 10, windowMs: 60 * 60_000 },
  refresh: { limit: 120, windowMs: 15 * 60_000 },
  google: { limit: 30, windowMs: 15 * 60_000 },
};

export function scaleLimits(limits: RateLimits, scale: number): RateLimits {
  const s = (l: { limit: number; windowMs: number }) => ({ ...l, limit: l.limit * scale });
  return {
    login: s(limits.login),
    register: s(limits.register),
    refresh: s(limits.refresh),
    google: s(limits.google),
  };
}

export function limiter(
  cfg: { limit: number; windowMs: number },
  keyByEmail = false,
): RequestHandler {
  return rateLimit({
    windowMs: cfg.windowMs,
    limit: cfg.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ip = ipKeyGenerator(req.ip ?? 'unknown');
      if (!keyByEmail) return ip;
      const body: unknown = req.body;
      const email =
        typeof body === 'object' &&
        body !== null &&
        'email' in body &&
        typeof body.email === 'string'
          ? body.email.trim().toLowerCase()
          : '';
      return `${ip}|${email}`;
    },
    handler: (_req, _res, next) => {
      next(
        new AppError(
          'RATE_LIMITED',
          429,
          'Too many attempts. Please wait a few minutes and try again.',
        ),
      );
    },
  });
}
