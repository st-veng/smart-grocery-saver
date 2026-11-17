import type { HistoryResponse } from '@sgs/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSelection, MAX_SERIES } from './components/PriceChart';
import { mockApi, renderAt, signedIn, USER } from './test-utils';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HONEY = {
  id: uuid(1),
  slug: 'honey',
  name: 'Pure Clover Honey',
  categoryId: 7,
  categoryName: 'Canned & Condiments',
  dimension: 'mass',
  displayUnit: 'oz',
  defaultQuantity: 12,
  defaultUnit: 'oz',
  avgEachGrams: null,
};
const STORE_NAMES = ['Walmart', 'Costco', 'Target', 'Kroger', 'H-E-B', 'Aldi'];
const STORES = STORE_NAMES.map((name, i) => ({
  id: i + 1,
  slug: name.toLowerCase(),
  name,
  brandColor: '#000000',
  requiresMembership: false,
  loyaltyProgram: null,
}));

function history(range = '90d', atLow = false): HistoryResponse {
  return {
    product: HONEY as HistoryResponse['product'],
    range: range as HistoryResponse['range'],
    from: '2026-08-04',
    to: '2026-11-01',
    stores: STORES,
    // Store 1 cheapest today … store 6 dearest. Usual store (USER.baselineStoreId = 5) is H-E-B.
    series: STORES.map((s) => ({
      storeId: s.id,
      points: [
        { date: '2026-08-04', unitPriceCents: 30 + s.id },
        { date: '2026-10-01', unitPriceCents: 25 + s.id },
      ],
    })),
    historicLow: { unitPriceCents: 26, storeId: 1, date: '2026-10-01' },
    current: { unitPriceCents: 26, storeId: 1 },
    atHistoricLow: atLow,
  };
}

const OFFERS = { product: HONEY, asOf: '2026-11-01', stores: STORES, offers: [] };

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

describe('defaultSelection', () => {
  it('picks the cheapest stores today plus the usual store, at most 4', () => {
    expect(defaultSelection(history(), 5)).toEqual([1, 2, 3, 5]);
    expect(defaultSelection(history(), 2)).toEqual([1, 2, 3, 4]);
    expect(defaultSelection(history(), null)).toHaveLength(MAX_SERIES);
  });
});

describe('product history', () => {
  it('shows the 1-year low, a legend of every store with ≤ 4 drawn, and a data table', async () => {
    mockApi({
      ...signedIn(),
      [`GET /products/${uuid(1)}/offers`]: { status: 200, body: OFFERS },
      [`GET /products/${uuid(1)}/history`]: { status: 200, body: history('90d', true) },
      'GET /alerts': { status: 200, body: { alerts: [] } },
    });
    renderAt(`/products/${uuid(1)}`);
    expect(await screen.findByText(/1-year low:/)).toHaveTextContent(
      '1-year low: 26.0¢/oz at Walmart on Oct 1, 2026',
    );
    expect(screen.getByText('At its 1-year low')).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: 'Stores in chart' });
    const boxes = within(legend).getAllByRole('checkbox');
    expect(boxes).toHaveLength(6);
    expect(
      boxes
        .filter((b) => (b as HTMLInputElement).checked)
        .map((b) => b.closest('label')?.textContent),
    ).toEqual(['Walmart', 'Costco', 'Target', 'H-E-B']);
    // Full: an unchecked store can't be added until one is removed.
    expect(within(legend).getByRole('checkbox', { name: 'Aldi' })).toBeDisabled();
    await userEvent.click(within(legend).getByRole('checkbox', { name: 'Target' }));
    expect(within(legend).getByRole('checkbox', { name: 'Aldi' })).toBeEnabled();
    expect(screen.getByRole('figure')).toHaveAttribute('data-visible-series', '3');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    expect(within(table).getByRole('row', { name: /Walmart/ })).toHaveTextContent(
      'Walmart26.0¢/oz26.0¢/oz31.0¢/oz',
    );
  });

  it('switching to 1 year asks the API for range=365d', async () => {
    const calls = mockApi({
      ...signedIn(),
      [`GET /products/${uuid(1)}/offers`]: { status: 200, body: OFFERS },
      [`GET /products/${uuid(1)}/history`]: (c) => ({
        status: 200,
        body: history(/range=(\w+)/.exec(c.url)?.[1] ?? '90d'),
      }),
      'GET /alerts': { status: 200, body: { alerts: [] } },
    });
    renderAt(`/products/${uuid(1)}`);
    await screen.findByRole('list', { name: 'Stores in chart' });
    await userEvent.click(screen.getByRole('radio', { name: '1 year' }));
    await waitFor(() => {
      expect(calls.filter((c) => c.path.endsWith('/history')).at(-1)?.url).toContain('range=365d');
    });
    expect(screen.getByRole('radio', { name: '1 year' })).toBeChecked();
  });

  it('creates a 1-year-low alert and a target-price alert in cents per display unit', async () => {
    const calls = mockApi({
      ...signedIn(),
      [`GET /products/${uuid(1)}/offers`]: { status: 200, body: OFFERS },
      [`GET /products/${uuid(1)}/history`]: { status: 200, body: history() },
      'GET /alerts': { status: 200, body: { alerts: [] } },
      'POST /alerts': (c) => ({
        status: 201,
        body: {
          alert: {
            id: uuid(9),
            product: HONEY,
            kind: (c.body as { kind: string }).kind,
            targetCents: null,
            active: true,
            lastTriggeredAt: null,
            createdAt: '2026-11-01T00:00:00Z',
          },
        },
      }),
    });
    renderAt(`/products/${uuid(1)}`);
    await userEvent.click(await screen.findByRole('button', { name: /Alert me at a 1-year low/ }));
    await userEvent.type(screen.getByLabelText('Alert me when it drops to ($ per oz)'), '0.25');
    await userEvent.click(screen.getByRole('button', { name: 'Set' }));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
    });
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { productId: uuid(1), kind: 'historic_low' },
      { productId: uuid(1), kind: 'target_price', targetCents: 25 },
    ]);
  });
});

describe('bell and notifications', () => {
  const NOTE = {
    id: uuid(70),
    kind: 'historic_low',
    createdAt: '2026-11-02T12:00:00Z',
    read: false,
    productId: uuid(1),
    productName: 'Pure Clover Honey',
    storeName: 'Walmart',
    unitPriceCents: 10.4,
    displayUnit: 'oz',
    priorLowCents: 21.6,
    targetCents: null,
    promoLabel: 'Clearance',
    asOf: '2026-11-02',
  };

  it('shows the unread count, and opening a notification marks it read and goes to the product', async () => {
    const calls = mockApi({
      ...signedIn(),
      'GET /notifications': { status: 200, body: { notifications: [NOTE], unreadCount: 1 } },
      [`POST /notifications/${uuid(70)}/read`]: { status: 204 },
      [`GET /products/${uuid(1)}/offers`]: { status: 200, body: OFFERS },
      [`GET /products/${uuid(1)}/history`]: { status: 200, body: history() },
      'GET /alerts': { status: 200, body: { alerts: [] } },
    });
    const { router } = renderAt('/');
    const bell = await screen.findByRole('link', { name: 'Notifications, 1 unread' });
    expect(within(bell).getByTestId('unread-badge')).toHaveTextContent('1');
    await userEvent.click(bell);
    const item = await screen.findByText(/hit a 1-year low/);
    expect(item).toHaveTextContent(
      'Pure Clover Honey hit a 1-year low at Walmart: 10.4¢/oz (previous low 21.6¢/oz).',
    );
    await userEvent.click(screen.getByRole('link', { name: 'View Pure Clover Honey' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/products/${uuid(1)}`);
    });
    expect(
      calls.some((c) => c.method === 'POST' && c.path === `/notifications/${uuid(70)}/read`),
    ).toBe(true);
    expect(USER.baselineStoreId).toBe(5);
  });
});
