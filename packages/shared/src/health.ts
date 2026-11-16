import { z } from 'zod';

export const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeS: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

const CheckResult = z.object({ ok: z.boolean(), detail: z.string().optional() });

export const ReadyResponse = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    database: CheckResult,
    migrations: CheckResult.extend({ applied: z.number().int().nonnegative() }),
    provider: CheckResult.extend({ id: z.string() }),
  }),
  /** Lets the web app show the "Demo prices" banner while the mock provider is active (Q-9). */
  priceProvider: z.string(),
  metro: z.string(),
});
export type ReadyResponse = z.infer<typeof ReadyResponse>;
