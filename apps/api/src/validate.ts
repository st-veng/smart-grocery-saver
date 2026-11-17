import type { Request } from 'express';
import { z } from 'zod';
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

const Uuid = z.uuid();
export const Paging = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.coerce.number().int().min(0).default(0),
});

/** Path ids that are not UUIDs can't exist: 404 (not 400) so probing reveals nothing. */
export function idParam(req: Request, name: string): string {
  const v = req.params[name];
  const r = Uuid.safeParse(v);
  if (!r.success) throw new AppError('NOT_FOUND', 404, 'Not found');
  return r.data;
}
