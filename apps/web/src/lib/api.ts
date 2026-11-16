import { ErrorResponse, ReadyResponse } from '@sgs/shared';
import type { z } from 'zod';

export interface FieldError {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: readonly FieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time, shared by every request that hit a 401 (silent refresh). */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/v1/auth/refresh', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'sgs', Accept: 'application/json' },
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function toFieldErrors(details: unknown): FieldError[] {
  if (!Array.isArray(details)) return [];
  return details.flatMap((d: unknown) => {
    if (typeof d !== 'object' || d === null) return [];
    const { path, message } = d as { path?: unknown; message?: unknown };
    return Array.isArray(path) && typeof message === 'string'
      ? [
          {
            path: path.filter(
              (p): p is string | number => typeof p === 'string' || typeof p === 'number',
            ),
            message,
          },
        ]
      : [];
  });
}

/**
 * Call the API and validate the response against the shared contract.
 * Non-GET requests carry the CSRF header. A 401 on a non-auth endpoint triggers one silent refresh
 * and a retry. `schema: null` means "no body expected" (204).
 */
export async function api<S extends z.ZodType>(
  method: Method,
  path: string,
  schema: S | null,
  body?: unknown,
  init: { signal?: AbortSignal; retried?: boolean } = {},
): Promise<z.infer<S>> {
  const headers = new Headers({ Accept: 'application/json' });
  if (method !== 'GET') headers.set('X-Requested-With', 'sgs');
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(init.signal ? { signal: init.signal } : {}),
  });

  if (res.status === 401 && !init.retried && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api(method, path, schema, body, { ...init, retried: true });
  }

  const payload: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.ok || (schema && res.status === 503)) {
    if (schema === null) return undefined as z.infer<S>;
    const parsed = schema.safeParse(payload);
    if (parsed.success) return parsed.data;
    if (res.ok) throw new ApiError(res.status, 'INTERNAL', `Unexpected response from ${path}`);
  }
  const err = ErrorResponse.safeParse(payload);
  if (err.success) {
    throw new ApiError(
      res.status,
      err.data.error.code,
      err.data.error.message,
      toFieldErrors(err.data.error.details),
    );
  }
  throw new ApiError(
    res.status,
    'INTERNAL',
    `Unexpected response from ${path} (${String(res.status)})`,
  );
}

export const fetchReady = (signal?: AbortSignal) =>
  api('GET', '/health/ready', ReadyResponse, undefined, signal ? { signal } : {});

/** First field error message per top-level field, for form display. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const d of e.details) {
    const key = String(d.path[0] ?? '');
    if (key && !(key in out)) out[key] = d.message;
  }
  return out;
}
