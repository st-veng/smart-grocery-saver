import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, READY, renderAt, signedIn, USER } from './test-utils';

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

describe('App shell (signed in)', () => {
  it('shows API ok, the greeting and the demo-prices banner', async () => {
    mockApi(signedIn());
    renderAt('/');
    expect(await screen.findByText('API: ok')).toBeInTheDocument();
    expect(screen.getByText('Hi, Pat!')).toBeInTheDocument();
    expect(screen.getByRole('note', { name: 'Demo prices' })).toHaveTextContent(
      'not real store prices',
    );
  });

  it('shows not-ready when the API reports 503', async () => {
    mockApi({
      ...signedIn(),
      'GET /health/ready': {
        status: 503,
        body: {
          ...READY,
          status: 'not_ready',
          checks: { ...READY.checks, database: { ok: false, detail: 'down' } },
        },
      },
    });
    renderAt('/');
    expect(await screen.findByText('API: not ready')).toBeInTheDocument();
  });

  it('shows an alert with retry when the health check fails', async () => {
    mockApi({
      ...signedIn(),
      'GET /health/ready': { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } },
    });
    renderAt('/');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('API: unreachable');
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('dismisses the demo banner for the session', async () => {
    mockApi(signedIn());
    renderAt('/');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Dismiss demo prices notice' }),
    );
    expect(screen.queryByRole('note', { name: 'Demo prices' })).not.toBeInTheDocument();
    expect(sessionStorage.getItem('sgs-demo-banner-dismissed')).toBe('1');
  });

  it('theme toggle cycles, applies dark mode and saves it to the account', async () => {
    const calls = mockApi({
      ...signedIn(),
      'PATCH /me': (c) => ({ status: 200, body: { user: { ...USER, ...(c.body as object) } } }),
    });
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: /Theme: System/ }));
    await userEvent.click(screen.getByRole('button', { name: /Theme: Light/ }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('sgs-theme')).toBe('dark');
    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches.map((c) => c.body)).toEqual([{ theme: 'light' }, { theme: 'dark' }]);
    expect(patches[0]?.headers.get('X-Requested-With')).toBe('sgs');
  });

  it('navigates to placeholder pages via the primary nav', async () => {
    mockApi(signedIn());
    renderAt('/');
    const nav = await screen.findByRole('navigation', { name: 'Primary' });
    await userEvent.click(within(nav).getByRole('link', { name: /Deals/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Deals & History' })).toBeInTheDocument();
    expect(screen.getByText('Coming in Phase 5.')).toBeInTheDocument();
  });
});
