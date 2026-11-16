import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from './App';

const READY = {
  status: 'ready',
  checks: {
    database: { ok: true },
    migrations: { ok: true, applied: 1 },
    provider: { ok: true, id: 'mock' },
  },
  priceProvider: 'mock',
  metro: 'DFW',
};

function renderAt(path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App shell', () => {
  it('shows API ok and the demo-prices banner when the mock provider is ready', async () => {
    mockFetch(200, READY);
    renderAt();
    expect(await screen.findByText('API: ok')).toBeInTheDocument();
    expect(screen.getByRole('note', { name: 'Demo prices' })).toHaveTextContent(
      'not real store prices',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'My Lists' })).toBeInTheDocument();
  });

  it('shows not-ready when the API reports 503', async () => {
    mockFetch(503, {
      ...READY,
      status: 'not_ready',
      checks: { ...READY.checks, database: { ok: false, detail: 'down' } },
    });
    renderAt();
    expect(await screen.findByText('API: not ready')).toBeInTheDocument();
  });

  it('shows an alert with retry when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    renderAt();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('API: unreachable');
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('dismisses the demo banner for the session', async () => {
    mockFetch(200, READY);
    renderAt();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Dismiss demo prices notice' }),
    );
    expect(screen.queryByRole('note', { name: 'Demo prices' })).not.toBeInTheDocument();
    expect(sessionStorage.getItem('sgs-demo-banner-dismissed')).toBe('1');
  });

  it('theme toggle cycles and applies dark mode', async () => {
    mockFetch(200, READY);
    renderAt();
    const toggle = screen.getByRole('button', { name: /Theme: System/ });
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: /Theme: Light/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Theme: Light/ }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('sgs-theme')).toBe('dark');
  });

  it('navigates to placeholder pages via the primary nav', async () => {
    mockFetch(200, READY);
    renderAt();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await userEvent.click(within(nav).getByRole('link', { name: /Compare/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Compare' })).toBeInTheDocument();
    expect(screen.getByText('Coming in Phase 4.')).toBeInTheDocument();
  });
});
