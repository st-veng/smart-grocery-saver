import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, MY_STORES, READY, renderAt, signedIn, USER } from './test-utils';

const signedOut = {
  'GET /auth/me': {
    status: 401,
    body: { error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } },
  },
  'POST /auth/refresh': {
    status: 401,
    body: { error: { code: 'UNAUTHENTICATED', message: 'Session expired' } },
  },
  'GET /health/ready': { status: 200, body: READY },
};

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

describe('route guards', () => {
  it('sends signed-out visitors to login, remembering where they were going', async () => {
    mockApi(signedOut);
    const { router } = renderAt('/dashboard');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?next=%2Fdashboard');
  });

  it('sends signed-in users who have not finished setup to onboarding', async () => {
    mockApi({ ...signedIn({ ...USER, onboarded: false, homeZip: null, home: null }) });
    const { router } = renderAt('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Where do you shop from?' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/onboarding');
  });

  it('silently refreshes an expired session and continues', async () => {
    let meCalls = 0;
    const calls = mockApi({
      ...signedIn(),
      'GET /auth/me': () =>
        ++meCalls === 1
          ? { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } }
          : { status: 200, body: { user: USER } },
      'POST /auth/refresh': { status: 200, body: { user: USER } },
    });
    renderAt('/');
    expect(await screen.findByText('Hi, Pat!')).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
  });

  it('sends signed-in users away from the login page', async () => {
    mockApi(signedIn());
    const { router } = renderAt('/login?next=/settings');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings');
    });
  });
});

describe('login & register', () => {
  it('validates on the client before calling the API', async () => {
    const calls = mockApi(signedOut);
    renderAt('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
      'Enter a valid email address',
    );
    expect(calls.some((c) => c.path === '/auth/login')).toBe(false);
  });

  it('shows the server message for bad credentials', async () => {
    mockApi({
      ...signedOut,
      'POST /auth/login': {
        status: 401,
        body: { error: { code: 'UNAUTHENTICATED', message: 'Email or password is incorrect' } },
      },
    });
    renderAt('/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'pat@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
  });

  it('signs in and lands on the page that was requested', async () => {
    const calls = mockApi({
      ...signedOut,
      'POST /auth/login': { status: 200, body: { user: USER } },
    });
    const { router } = renderAt('/login?next=%2Fsettings');
    await userEvent.type(await screen.findByLabelText('Email'), ' Pat@Example.com ');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings');
    });
    const login = calls.find((c) => c.path === '/auth/login');
    expect(login?.body).toEqual({ email: 'pat@example.com', password: 'correct horse battery' });
    expect(login?.headers.get('X-Requested-With')).toBe('sgs');
  });

  it('shows Google errors passed back on the login URL', async () => {
    mockApi(signedOut);
    renderAt('/login?error=google_unverified');
    expect(await screen.findByRole('alert')).toHaveTextContent('not verified');
    expect(screen.getByRole('link', { name: /Continue with Google/ })).toHaveAttribute(
      'href',
      '/api/v1/auth/google?returnTo=%2F',
    );
  });

  it('register enforces the 10-character password minimum and shows server conflicts', async () => {
    mockApi({
      ...signedOut,
      'POST /auth/register': {
        status: 409,
        body: { error: { code: 'CONFLICT', message: 'An account with this email already exists' } },
      },
    });
    renderAt('/register');
    await userEvent.type(await screen.findByLabelText('Your name'), 'Pat');
    await userEvent.type(screen.getByLabelText('Email'), 'pat@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(/at least 10 characters/);
    await userEvent.type(screen.getByLabelText('Password'), ' and long enough');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });
});

describe('onboarding', () => {
  it('walks ZIP → stores → car and finishes setup', async () => {
    let user = {
      ...USER,
      onboarded: false,
      homeZip: null as string | null,
      home: null as object | null,
      baselineStoreId: null as number | null,
    };
    const calls = mockApi({
      'GET /health/ready': { status: 200, body: READY },
      'GET /auth/me': () => ({ status: 200, body: { user } }),
      'PATCH /me': (c) => {
        const b = c.body as Record<string, unknown>;
        user = {
          ...user,
          ...(b.homeZip ? { homeZip: b.homeZip as string, home: { lat: 33.1, lng: -96.8 } } : {}),
          ...(b.baselineStoreId ? { baselineStoreId: b.baselineStoreId as number } : {}),
          ...(b.completeOnboarding ? { onboarded: true } : {}),
        };
        return { status: 200, body: { user } };
      },
      'GET /me/stores': { status: 200, body: MY_STORES },
      'PUT /me/stores': (c) => ({
        status: 200,
        body: {
          ...MY_STORES,
          stores: MY_STORES.stores.map((s) => ({ ...s, saved: true })),
          _echo: c.body,
        },
      }),
    });
    const { router } = renderAt('/onboarding');

    await userEvent.type(await screen.findByLabelText('Home ZIP code'), '75034');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Step 2: nearby chains pre-checked, far one not; loyalty card on; membership offered for Costco.
    expect(await screen.findByRole('heading', { name: 'Pick your stores' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^Walmart/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^Trader Joe's/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Use my Kroger Plus Card prices' })).toBeChecked();
    const member = screen.getByRole('checkbox', { name: 'I have a Costco membership' });
    expect(member).not.toBeChecked();
    await userEvent.click(member);
    expect(
      within(screen.getByRole('combobox', { name: 'Your usual store' })).getByRole('option', {
        name: 'Kroger',
      }),
    ).toHaveProperty('selected', true);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: 'Your car' })).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Miles per gallon'));
    await userEvent.type(screen.getByLabelText('Miles per gallon'), '31');
    await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });

    const put = calls.find((c) => c.method === 'PUT')?.body as {
      stores: { storeId: number; enabled: boolean; hasMembership: boolean; hasLoyalty: boolean }[];
    };
    expect(put.stores.find((s) => s.storeId === 2)).toMatchObject({
      enabled: true,
      hasMembership: true,
    });
    expect(put.stores.find((s) => s.storeId === 10)).toMatchObject({ enabled: false });
    expect(put.stores.find((s) => s.storeId === 5)).toMatchObject({ hasLoyalty: true });
    const patches = calls.filter((c) => c.method === 'PATCH').map((c) => c.body);
    expect(patches).toEqual([
      { homeZip: '75034' },
      { baselineStoreId: 5 },
      { vehicleMpg: 31, completeOnboarding: true },
    ]);
  });

  it('shows the server message for a ZIP outside DFW', async () => {
    mockApi({
      ...signedIn({ ...USER, onboarded: false, homeZip: null, home: null }),
      'PATCH /me': {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'We only cover the Dallas–Fort Worth area for now',
            details: [{ path: ['homeZip'], message: 'ZIP code is not in the DFW service area' }],
          },
        },
      },
    });
    renderAt('/onboarding');
    await userEvent.type(await screen.findByLabelText('Home ZIP code'), '10001');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('ZIP code is not in the DFW service area')).toBeInTheDocument();
  });
});

describe('settings', () => {
  it('signs out and returns to login', async () => {
    let signedInNow = true;
    const calls = mockApi({
      'GET /health/ready': { status: 200, body: READY },
      'GET /auth/me': () =>
        signedInNow
          ? { status: 200, body: { user: USER } }
          : { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } },
      'POST /auth/refresh': {
        status: 401,
        body: { error: { code: 'UNAUTHENTICATED', message: 'x' } },
      },
      'GET /me/stores': { status: 200, body: MY_STORES },
      'POST /auth/logout': () => {
        signedInNow = false;
        return { status: 204 };
      },
    });
    const { router } = renderAt('/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    expect(calls.some((c) => c.method === 'POST' && c.path === '/auth/logout')).toBe(true);
  });
});
