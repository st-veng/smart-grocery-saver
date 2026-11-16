import type { z } from 'zod';
import { AppError } from './errors.js';

/** Parse a request payload with a shared schema; 400 VALIDATION_FAILED with field details on failure. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  throw new AppError(
    'VALIDATION_FAILED',
    400,
    r.error.issues[0]?.message ?? 'Invalid request',
    r.error.issues.map((i) => ({
      path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
      message: i.message,
    })),
  );
}
