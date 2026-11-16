import type { CookieOptions, Response } from 'express';
import { ACCESS_TTL_S, OAUTH_STATE_TTL_S, REFRESH_TTL_S } from './tokens.js';

export const ACCESS_COOKIE = 'sgs_at';
export const REFRESH_COOKIE = 'sgs_rt';
export const OAUTH_COOKIE = 'sgs_oauth';
export const REFRESH_PATH = '/api/v1/auth';
export const OAUTH_PATH = '/api/v1/auth/google';

const base = (secure: boolean): CookieOptions => ({ httpOnly: true, sameSite: 'lax', secure });

export function setAuthCookies(
  res: Response,
  secure: boolean,
  accessToken: string,
  refreshToken: string,
): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...base(secure),
    path: '/',
    maxAge: ACCESS_TTL_S * 1000,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base(secure),
    path: REFRESH_PATH,
    maxAge: REFRESH_TTL_S * 1000,
  });
}

export function clearAuthCookies(res: Response, secure: boolean): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(secure), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base(secure), path: REFRESH_PATH });
}

export function setOAuthCookie(res: Response, secure: boolean, value: string): void {
  res.cookie(OAUTH_COOKIE, value, {
    ...base(secure),
    path: OAUTH_PATH,
    maxAge: OAUTH_STATE_TTL_S * 1000,
  });
}

export function clearOAuthCookie(res: Response, secure: boolean): void {
  res.clearCookie(OAUTH_COOKIE, { ...base(secure), path: OAUTH_PATH });
}

export function readCookie(cookies: unknown, name: string): string | null {
  if (typeof cookies !== 'object' || cookies === null) return null;
  const v = (cookies as Record<string, unknown>)[name];
  return typeof v === 'string' && v.length > 0 ? v : null;
}
