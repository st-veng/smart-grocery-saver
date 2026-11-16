import { isIsoDate, parseLatLng } from '@sgs/core';
import { z } from 'zod';

export const DEV_JWT_SECRET = 'dev-only-change-me-dev-only-change-me';

const blankToUndefined = (v: unknown) => (v === '' ? undefined : v);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.url().default('postgres://sgs:sgs@localhost:5433/sgs_dev'),
    WEB_ORIGIN: z.url().default('http://localhost:5173'),
    PRICE_PROVIDER: z.enum(['mock']).default('mock'),
    METRO: z.enum(['DFW']).default('DFW'),
    SEED: z.string().min(1).default('20261116'),
    SEED_ANCHOR_DATE: z
      .preprocess(blankToUndefined, z.string().optional())
      .refine((v) => v === undefined || isIsoDate(v), 'SEED_ANCHOR_DATE must be YYYY-MM-DD'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    JWT_SECRET: z
      .string()
      .min(32, 'JWT_SECRET must be at least 32 characters')
      .default(DEV_JWT_SECRET),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    GOOGLE_CLIENT_ID: z.preprocess(blankToUndefined, z.string().optional()),
    GOOGLE_CLIENT_SECRET: z.preprocess(blankToUndefined, z.string().optional()),
    GOOGLE_REDIRECT_URI: z.url().default('http://localhost:4000/api/v1/auth/google/callback'),
    AUTH_GOOGLE_MODE: z.preprocess(blankToUndefined, z.enum(['mock', 'real']).optional()),
    /** Multiplies every auth rate limit (e2e runs many sign-ins from one IP). Must stay 1 in production. */
    AUTH_RATE_LIMIT_SCALE: z.coerce.number().int().min(1).max(1000).default(1),
    PRESELECT_RADIUS_MILES: z.coerce.number().positive().max(100).default(7),
    DEFAULT_ORIGIN: z
      .string()
      .default('33.1500,-96.8065')
      .transform((v, ctx) => {
        try {
          return parseLatLng(v);
        } catch {
          ctx.addIssue({ code: 'custom', message: 'DEFAULT_ORIGIN must be "lat,lng"' });
          return z.NEVER;
        }
      }),
  })
  .transform((env, ctx) => {
    // Missing Google credentials ⇒ mock mode automatically (CLAUDE.md).
    const googleMode = env.AUTH_GOOGLE_MODE ?? (env.GOOGLE_CLIENT_ID ? 'real' : 'mock');
    if (googleMode === 'real' && (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_ID'],
        message: 'AUTH_GOOGLE_MODE=real requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (googleMode === 'mock') {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_GOOGLE_MODE'],
          message: 'The mock Google login is not allowed with NODE_ENV=production',
        });
      }
      if (env.JWT_SECRET === DEV_JWT_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_SECRET'],
          message: 'Set a real JWT_SECRET in production',
        });
      }
      if (env.AUTH_RATE_LIMIT_SCALE !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_RATE_LIMIT_SCALE'],
          message: 'AUTH_RATE_LIMIT_SCALE must be 1 in production',
        });
      }
      if (!env.COOKIE_SECURE) {
        ctx.addIssue({
          code: 'custom',
          path: ['COOKIE_SECURE'],
          message: 'COOKIE_SECURE must be true in production',
        });
      }
    }
    return { ...env, googleMode };
  });

export type Config = z.infer<typeof EnvSchema>;

/** Parse and validate the environment. Fails fast with every problem listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${problems}`);
  }
  return parsed.data;
}
