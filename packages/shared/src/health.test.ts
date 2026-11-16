import { describe, expect, it } from 'vitest';
import { ErrorResponse, HealthResponse, ReadyResponse } from './index.js';

describe('shared contract', () => {
  it('accepts valid payloads', () => {
    expect(HealthResponse.parse({ status: 'ok', version: '0.1.0', uptimeS: 3 })).toBeTruthy();
    expect(
      ReadyResponse.parse({
        status: 'ready',
        checks: {
          database: { ok: true },
          migrations: { ok: true, applied: 1 },
          provider: { ok: true, id: 'mock' },
        },
        priceProvider: 'mock',
        metro: 'DFW',
      }),
    ).toBeTruthy();
    expect(ErrorResponse.parse({ error: { code: 'NOT_FOUND', message: 'x' } })).toBeTruthy();
  });

  it('rejects invalid payloads', () => {
    expect(HealthResponse.safeParse({ status: 'nope', version: '1', uptimeS: 1 }).success).toBe(
      false,
    );
    expect(ErrorResponse.safeParse({ error: { code: 'TEAPOT', message: 'x' } }).success).toBe(
      false,
    );
  });
});
