/**
 * argon2id parameters (OWASP Password Storage Cheat Sheet minimum: m=19 MiB, t=2, p=1).
 * Shared by the API and the dev seed (demo user). Pure data — no hashing here.
 */
export const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;
