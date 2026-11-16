import { hash, verify } from '@node-rs/argon2';
import { ARGON2_OPTIONS } from '@sgs/core';

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

// A real argon2id hash of a random string, so unknown-email logins cost the same as real ones.
let dummyHash: Promise<string> | null = null;
function dummy(): Promise<string> {
  dummyHash ??= hash(`dummy-${String(Math.random())}`, ARGON2_OPTIONS);
  return dummyHash;
}

/**
 * Verify a password. With no stored hash (unknown email, or a Google-only account) a dummy hash is
 * still verified, so response timing does not reveal whether the account exists.
 */
export async function verifyPassword(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  if (storedHash === null) {
    await verify(await dummy(), password).catch(() => false);
    return false;
  }
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}
