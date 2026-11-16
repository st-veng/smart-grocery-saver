import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

export const ACCESS_TTL_S = 15 * 60;
export const REFRESH_TTL_S = 30 * 24 * 60 * 60;
export const OAUTH_STATE_TTL_S = 10 * 60;
const ISSUER = 'sgs-api';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Refresh tokens are stored only as sha256 hashes. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export interface AccessClaims {
  readonly userId: string;
  readonly sessionId: string;
}

export interface OAuthState {
  readonly state: string;
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly returnTo: string;
}

/** Signs/verifies the access JWT and the OAuth state cookie with an injected clock. */
export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly clock: () => Date,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  private nowS(): number {
    return Math.floor(this.clock().getTime() / 1000);
  }

  signAccess(c: AccessClaims): Promise<string> {
    const now = this.nowS();
    return new SignJWT({ sid: c.sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(c.userId)
      .setIssuer(ISSUER)
      .setAudience('sgs-web')
      .setIssuedAt(now)
      .setExpirationTime(now + ACCESS_TTL_S)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: 'sgs-web',
        algorithms: ['HS256'],
        currentDate: this.clock(),
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
      return { userId: payload.sub, sessionId: payload.sid };
    } catch {
      return null;
    }
  }

  signOAuthState(s: OAuthState): Promise<string> {
    const now = this.nowS();
    return new SignJWT({ ...s })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience('sgs-oauth')
      .setIssuedAt(now)
      .setExpirationTime(now + OAUTH_STATE_TTL_S)
      .sign(this.key);
  }

  async verifyOAuthState(token: string): Promise<OAuthState | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: 'sgs-oauth',
        algorithms: ['HS256'],
        currentDate: this.clock(),
      });
      const { state, codeVerifier, nonce, returnTo } = payload;
      if (
        typeof state !== 'string' ||
        typeof codeVerifier !== 'string' ||
        typeof nonce !== 'string' ||
        typeof returnTo !== 'string'
      ) {
        return null;
      }
      return { state, codeVerifier, nonce, returnTo };
    } catch {
      return null;
    }
  }
}

/** Only same-site relative paths; anything else becomes '/' (open-redirect guard). */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.length > 512
  ) {
    return '/';
  }
  return value;
}
