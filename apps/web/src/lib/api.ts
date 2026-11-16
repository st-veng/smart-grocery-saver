import { ErrorResponse, ReadyResponse } from '@sgs/shared';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Fetch JSON from the API and validate it against the shared contract. */
export async function apiGet<S extends z.ZodType>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<z.infer<S>> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  const res = await fetch(`/api/v1${path}`, { ...init, headers });
  const body: unknown = await res.json().catch(() => null);
  // /health/ready returns a valid ReadyResponse with 503 when not ready — still a usable payload.
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const err = ErrorResponse.safeParse(body);
  if (err.success) throw new ApiError(res.status, err.data.error.code, err.data.error.message);
  throw new ApiError(res.status, 'INTERNAL', `Unexpected response from ${path} (${res.status})`);
}

export const fetchReady = (signal?: AbortSignal) =>
  apiGet('/health/ready', ReadyResponse, signal ? { signal } : {});
