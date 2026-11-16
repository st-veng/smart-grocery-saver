import { isIsoDate } from '@sgs/core';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.url().default('postgres://sgs:sgs@localhost:5433/sgs_dev'),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  PRICE_PROVIDER: z.enum(['mock']).default('mock'),
  METRO: z.enum(['DFW']).default('DFW'),
  SEED: z.string().min(1).default('20261116'),
  SEED_ANCHOR_DATE: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v))
    .refine((v) => v === undefined || isIsoDate(v), 'SEED_ANCHOR_DATE must be YYYY-MM-DD'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
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
