import { describe, expect, it } from 'vitest';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../../core/src/auth-params.js';
import {
  LoginRequest,
  PASSWORD_MAX,
  PASSWORD_MIN,
  PutMyStoresRequest,
  RegisterRequest,
  UpdateProfileRequest,
} from './auth.js';

describe('auth contract', () => {
  it('password limits match @sgs/core', () => {
    expect(PASSWORD_MIN).toBe(PASSWORD_MIN_LENGTH);
    expect(PASSWORD_MAX).toBe(PASSWORD_MAX_LENGTH);
  });

  it('normalizes email and enforces password length', () => {
    expect(
      RegisterRequest.parse({
        email: '  Pat@Example.COM ',
        password: 'x'.repeat(10),
        displayName: ' Pat ',
      }),
    ).toEqual({
      email: 'pat@example.com',
      password: 'x'.repeat(10),
      displayName: 'Pat',
    });
    expect(
      RegisterRequest.safeParse({ email: 'pat@example.com', password: 'short', displayName: 'P' })
        .success,
    ).toBe(false);
    expect(LoginRequest.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
  });

  it('profile updates are partial and strict', () => {
    expect(UpdateProfileRequest.parse({ homeZip: '75034' })).toEqual({ homeZip: '75034' });
    expect(UpdateProfileRequest.safeParse({ homeZip: '7503' }).success).toBe(false);
    expect(UpdateProfileRequest.safeParse({ email: 'x@y.z' }).success).toBe(false);
    expect(UpdateProfileRequest.safeParse({ completeOnboarding: false }).success).toBe(false);
  });

  it('store settings reject unknown fields and empty lists', () => {
    const ok = {
      storeId: 1,
      enabled: true,
      hasMembership: false,
      hasLoyalty: true,
      preferredLocationId: null,
    };
    expect(PutMyStoresRequest.safeParse({ stores: [ok] }).success).toBe(true);
    expect(PutMyStoresRequest.safeParse({ stores: [] }).success).toBe(false);
    expect(PutMyStoresRequest.safeParse({ stores: [{ ...ok, admin: true }] }).success).toBe(false);
  });
});
