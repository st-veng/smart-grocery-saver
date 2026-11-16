/**
 * Google sign-in: OIDC Authorization Code + PKCE (real), or a local mock consent screen (dev/test).
 * Both implement GoogleClient so the routes and account-linking logic are identical in either mode.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { pkceChallenge } from './tokens.js';

export interface GoogleIdentity {
  readonly sub: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string | null;
}

export interface GoogleClient {
  readonly mode: 'real' | 'mock';
  authorizationUrl(p: { state: string; codeChallenge: string; nonce: string }): string;
  exchange(p: { code: string; codeVerifier: string; nonce: string }): Promise<GoogleIdentity>;
}

export class GoogleAuthError extends Error {
  override readonly name = 'GoogleAuthError';
}

export interface RealGoogleConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly authorizationEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly issuers?: readonly string[];
  /** Override for tests (local signing key); defaults to Google's published JWKS. */
  readonly jwks?: JWTVerifyGetKey;
  readonly fetch?: typeof fetch;
  readonly clock?: () => Date;
}

export class RealGoogleClient implements GoogleClient {
  readonly mode = 'real' as const;
  private readonly jwks: JWTVerifyGetKey;

  constructor(private readonly cfg: RealGoogleConfig) {
    this.jwks =
      cfg.jwks ?? createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  }

  authorizationUrl(p: { state: string; codeChallenge: string; nonce: string }): string {
    const u = new URL(
      this.cfg.authorizationEndpoint ?? 'https://accounts.google.com/o/oauth2/v2/auth',
    );
    u.search = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: p.state,
      nonce: p.nonce,
      code_challenge: p.codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return u.toString();
  }

  async exchange(p: {
    code: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<GoogleIdentity> {
    const doFetch = this.cfg.fetch ?? fetch;
    const res = await doFetch(this.cfg.tokenEndpoint ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: p.code,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        redirect_uri: this.cfg.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: p.codeVerifier,
      }),
    });
    if (!res.ok) throw new GoogleAuthError(`token endpoint returned ${res.status}`);
    const body = (await res.json()) as { id_token?: unknown };
    if (typeof body.id_token !== 'string')
      throw new GoogleAuthError('no id_token in token response');
    try {
      const { payload } = await jwtVerify(body.id_token, this.jwks, {
        issuer: [...(this.cfg.issuers ?? ['https://accounts.google.com', 'accounts.google.com'])],
        audience: this.cfg.clientId,
        ...(this.cfg.clock ? { currentDate: this.cfg.clock() } : {}),
      });
      if (payload.nonce !== p.nonce) throw new GoogleAuthError('nonce mismatch');
      if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
        throw new GoogleAuthError('id_token missing sub/email');
      }
      return {
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        emailVerified: payload.email_verified === true,
        name: typeof payload.name === 'string' ? payload.name : null,
      };
    } catch (e) {
      if (e instanceof GoogleAuthError) throw e;
      throw new GoogleAuthError(`invalid id_token: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

interface MockCode extends GoogleIdentity {
  readonly nonce: string;
  readonly codeChallenge: string;
}

/**
 * Dev-only stand-in for Google. The "authorization code" carries the identity entered on the mock
 * consent page plus the PKCE challenge and nonce, which are verified exactly like the real flow.
 */
export class MockGoogleClient implements GoogleClient {
  readonly mode = 'mock' as const;

  authorizationUrl(p: { state: string; codeChallenge: string; nonce: string }): string {
    const q = new URLSearchParams({
      state: p.state,
      nonce: p.nonce,
      code_challenge: p.codeChallenge,
    });
    return `/api/v1/auth/google/mock?${q.toString()}`;
  }

  static encodeCode(c: MockCode): string {
    return `mock.${Buffer.from(JSON.stringify(c)).toString('base64url')}`;
  }

  exchange(p: { code: string; codeVerifier: string; nonce: string }): Promise<GoogleIdentity> {
    if (!p.code.startsWith('mock.')) return Promise.reject(new GoogleAuthError('not a mock code'));
    let c: Partial<MockCode>;
    try {
      c = JSON.parse(
        Buffer.from(p.code.slice(5), 'base64url').toString('utf8'),
      ) as Partial<MockCode>;
    } catch {
      return Promise.reject(new GoogleAuthError('malformed mock code'));
    }
    if (c.codeChallenge !== pkceChallenge(p.codeVerifier))
      return Promise.reject(new GoogleAuthError('PKCE mismatch'));
    if (c.nonce !== p.nonce) return Promise.reject(new GoogleAuthError('nonce mismatch'));
    if (typeof c.sub !== 'string' || typeof c.email !== 'string') {
      return Promise.reject(new GoogleAuthError('mock code missing identity'));
    }
    return Promise.resolve({
      sub: c.sub,
      email: c.email.toLowerCase(),
      emailVerified: c.emailVerified === true,
      name: c.name ?? null,
    });
  }
}
