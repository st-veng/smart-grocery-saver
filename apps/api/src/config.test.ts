import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ PORT: 4000, PRICE_PROVIDER: 'mock', METRO: 'DFW' });
    expect(c.SEED_ANCHOR_DATE).toBeUndefined();
  });

  it('treats an empty SEED_ANCHOR_DATE as unset and validates a given one', () => {
    expect(loadConfig({ SEED_ANCHOR_DATE: '' }).SEED_ANCHOR_DATE).toBeUndefined();
    expect(loadConfig({ SEED_ANCHOR_DATE: '2026-11-01' }).SEED_ANCHOR_DATE).toBe('2026-11-01');
    expect(() => loadConfig({ SEED_ANCHOR_DATE: '2026-13-01' })).toThrow(/SEED_ANCHOR_DATE/);
  });

  it('fails fast listing every invalid variable', () => {
    expect(() => loadConfig({ PORT: 'abc', PRICE_PROVIDER: 'real' })).toThrow(
      /PORT[\s\S]*PRICE_PROVIDER/,
    );
  });
});

describe('auth configuration guardrails', () => {
  const prod = { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), COOKIE_SECURE: 'true' };

  it('uses the mock Google login when no client id is configured', () => {
    expect(loadConfig({}).googleMode).toBe('mock');
    expect(loadConfig({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' }).googleMode).toBe(
      'real',
    );
  });

  it('refuses real mode without credentials', () => {
    expect(() => loadConfig({ AUTH_GOOGLE_MODE: 'real' })).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('refuses the mock login, the dev JWT secret and insecure cookies in production', () => {
    expect(() => loadConfig({ ...prod })).toThrow(/mock Google login is not allowed/);
    const ok = { ...prod, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' };
    expect(loadConfig(ok).googleMode).toBe('real');
    expect(() => loadConfig({ ...ok, JWT_SECRET: undefined })).toThrow(/real JWT_SECRET/);
    expect(() => loadConfig({ ...ok, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(() => loadConfig({ ...ok, AUTH_RATE_LIMIT_SCALE: '50' })).toThrow(
      /AUTH_RATE_LIMIT_SCALE/,
    );
    expect(() => loadConfig({ JWT_SECRET: 'too-short' })).toThrow(/at least 32/);
  });

  it('parses the pre-selection radius and default origin', () => {
    const c = loadConfig({ PRESELECT_RADIUS_MILES: '7', DEFAULT_ORIGIN: '33.1500,-96.8065' });
    expect(c.PRESELECT_RADIUS_MILES).toBe(7);
    expect(c.DEFAULT_ORIGIN).toEqual({ lat: 33.15, lng: -96.8065 });
    expect(() => loadConfig({ DEFAULT_ORIGIN: 'nowhere' })).toThrow(/DEFAULT_ORIGIN/);
  });
});
