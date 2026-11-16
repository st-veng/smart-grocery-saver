import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { routes } from './App';

export const READY = {
  status: 'ready',
  checks: {
    database: { ok: true },
    migrations: { ok: true, applied: 1 },
    provider: { ok: true, id: 'mock' },
  },
  priceProvider: 'mock',
  metro: 'DFW',
};

export const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'pat@example.com',
  displayName: 'Pat',
  homeZip: '75034',
  home: { lat: 33.12, lng: -96.84 },
  vehicleMpg: 25,
  fuelCentsPerGal: null,
  baselineStoreId: 5,
  theme: 'system',
  onboarded: true,
  hasPassword: true,
  providers: [],
};

const store = (id: number, slug: string, name: string, extra: object = {}) => ({
  id,
  slug,
  name,
  brandColor: '#000000',
  requiresMembership: false,
  loyaltyProgram: null,
  enabled: true,
  hasMembership: false,
  hasLoyalty: false,
  preferredLocationId: null,
  nearestLocation: { id: id * 10, name: `${name} – Frisco (mock)`, distanceMiles: id },
  preselected: true,
  saved: false,
  ...extra,
});

export const MY_STORES = {
  radiusMiles: 7,
  fallback: false,
  stores: [
    store(1, 'walmart', 'Walmart'),
    store(2, 'costco', 'Costco', { requiresMembership: true }),
    store(5, 'kroger', 'Kroger', { loyaltyProgram: 'Kroger Plus Card', hasLoyalty: true }),
    store(10, 'traderjoes', "Trader Joe's", {
      enabled: false,
      preselected: false,
      nearestLocation: { id: 100, name: "Trader Joe's – Plano (mock)", distanceMiles: 10.4 },
    }),
  ],
};

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly headers: Headers;
}

type Handler = (call: Call) => { status: number; body?: unknown } | undefined;

/** Route fetch calls ("GET /auth/me") to handlers; records every call. Unhandled routes → 404. */
export function mockApi(handlers: Record<string, Handler | { status: number; body?: unknown }>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = input.replace(/^\/api\/v1/, '').split('?')[0] ?? '';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      const call = { method, path, body, headers: new Headers(init?.headers) };
      calls.push(call);
      const h = handlers[`${method} ${path}`];
      const r = typeof h === 'function' ? h(call) : h;
      const status = r?.status ?? 404;
      const payload = r ? r.body : { error: { code: 'NOT_FOUND', message: 'not mocked' } };
      return Promise.resolve(
        new Response(status === 204 ? null : JSON.stringify(payload ?? null), { status }),
      );
    }),
  );
  return calls;
}

export function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client };
}

export const signedIn = (user: object = USER) => ({
  'GET /auth/me': { status: 200, body: { user } },
  'GET /health/ready': { status: 200, body: READY },
});
