import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { foldRows, rangeFor } from './routes/dashboard';
import { savedText } from './routes/trips';
import { mockApi, renderAt, signedIn } from './test-utils';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const range = { from: '2025-11-01', to: '2026-11-01' };
const summary = (over: object = {}) => ({
  ...range,
  tripCount: 3,
  totalSavedCents: 4321,
  totalSpentCents: 30000,
  baselineTotalCents: 34321,
  fuelSpentCents: 450,
  avgSavingsPct: 12.6,
  bestStore: { storeId: 7, name: 'Aldi', savedCents: 3000 },
  ...over,
});
const series = {
  ...range,
  metric: 'savings',
  interval: 'month',
  points: [
    { start: '2026-09-01', valueCents: 2500, tripCount: 2 },
    { start: '2026-10-01', valueCents: -120, tripCount: 1 },
    { start: '2026-11-01', valueCents: 0, tripCount: 0 },
  ],
};
const breakdown = {
  ...range,
  by: 'store',
  rows: [
    { key: 7, label: 'Aldi', spentCents: 9000, savedCents: 3000, itemCount: 20 },
    { key: 1, label: 'Walmart', spentCents: 21000, savedCents: 1321, itemCount: 30 },
  ],
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

describe('dashboard', () => {
  it('shows KPI cards, both charts with data tables, and range-scoped export links', async () => {
    const calls = mockApi({
      ...signedIn(),
      'GET /dashboard/summary': { status: 200, body: summary() },
      'GET /dashboard/series': { status: 200, body: series },
      'GET /dashboard/breakdown': { status: 200, body: breakdown },
    });
    renderAt('/dashboard');
    expect(await screen.findByTestId('kpi-saved')).toHaveTextContent('$43.21');
    expect(screen.getByTestId('kpi-pct')).toHaveTextContent('12.6%');
    expect(screen.getByTestId('kpi-trips')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-best')).toHaveTextContent('Aldi');
    expect(screen.getByText(/Spent \$300\.00 \(including \$4\.50 fuel\)/)).toBeInTheDocument();
    // A month where the user spent more is labelled in words, not colour alone.
    expect(await screen.findByText('Spent more than usual')).toBeInTheDocument();
    const tables = screen.getAllByRole('table', { hidden: true });
    expect(within(tables[0] as HTMLElement).getAllByRole('row', { hidden: true })).toHaveLength(4);
    const csv = screen.getByRole('link', { name: 'Download CSV' });
    expect(csv).toHaveAttribute('download');
    const href = csv.getAttribute('href') ?? '';
    expect(href).toMatch(
      /^\/api\/v1\/exports\/savings\.csv\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/,
    );
    // Changing the range re-queries every endpoint with the new dates.
    await userEvent.click(screen.getByText('3 months'));
    const froms = calls
      .filter((c) => c.path === '/dashboard/summary')
      .map((c) => new URL(c.url, 'http://x').searchParams.get('from'));
    expect(new Set(froms).size).toBe(2);
    expect(screen.getByRole('link', { name: 'Download PDF' }).getAttribute('href')).toContain(
      `from=${froms.at(-1) ?? ''}`,
    );
  });

  it('empty range: friendly empty state, no charts, exports still offered', async () => {
    mockApi({
      ...signedIn(),
      'GET /dashboard/summary': {
        status: 200,
        body: summary({
          tripCount: 0,
          totalSavedCents: 0,
          totalSpentCents: 0,
          baselineTotalCents: 0,
          fuelSpentCents: 0,
          avgSavingsPct: null,
          bestStore: null,
        }),
      },
      'GET /dashboard/series': { status: 200, body: series },
      'GET /dashboard/breakdown': { status: 200, body: breakdown },
    });
    renderAt('/dashboard');
    expect(await screen.findByText('No trips in this period yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-saved')).toBeNull();
    expect(screen.getByRole('link', { name: 'Compare a list' })).toHaveAttribute(
      'href',
      '/compare',
    );
    expect(screen.getByRole('link', { name: 'Download CSV' })).toBeInTheDocument();
  });

  it('shows an error state when the API fails', async () => {
    mockApi({
      ...signedIn(),
      'GET /dashboard/summary': {
        status: 500,
        body: { error: { code: 'INTERNAL', message: 'Boom' } },
      },
      'GET /dashboard/series': { status: 200, body: series },
      'GET /dashboard/breakdown': { status: 200, body: breakdown },
    });
    renderAt('/dashboard');
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
  });
});

describe('trip history', () => {
  const trip = {
    id: uuid(1),
    listId: uuid(2),
    listName: 'Family week',
    planType: 'multi',
    stores: [
      { id: 7, name: 'Aldi' },
      { id: 1, name: 'Walmart' },
    ],
    baselineStore: { id: 5, name: 'Kroger' },
    itemCount: 1,
    itemsTotalCents: 1000,
    fuelCostCents: 150,
    distanceMiles: 13.4,
    baselineTotalCents: 1100,
    savingsCents: -50,
    priceAsOf: '2026-10-30',
    shoppedOn: '2026-10-30',
    createdAt: '2026-10-30T18:00:00.000Z',
  };
  const detail = {
    ...trip,
    items: [
      {
        itemId: 'a',
        rawText: 'eggs',
        productName: 'Large Eggs',
        categoryName: 'Eggs',
        storeId: 7,
        storeItemId: uuid(3),
        title: 'Large Eggs 12 ct',
        packages: 1,
        lineCents: 1000,
        baselineLineCents: 1100,
        unitPriceCents: 83.3,
        displayUnit: 'ea',
        onSale: false,
        promoLabel: null,
        approximate: false,
      },
    ],
    skipped: [{ rawText: 'birthday candles', reason: 'unpriced' }],
    mpg: 25,
    fuelCentsPerGal: 279,
  };

  it('lists trips with the saving in words and opens the snapshot', async () => {
    mockApi({
      ...signedIn(),
      'GET /trips': { status: 200, body: { trips: [trip], nextCursor: null } },
      [`GET /trips/${trip.id}`]: { status: 200, body: { trip: detail } },
    });
    renderAt('/trips');
    const list = await screen.findByRole('list', { name: 'Trips, newest first' });
    expect(list).toHaveTextContent(/Aldi \+ Walmart · Family week · 1 items/);
    expect(list).toHaveTextContent('Spent $0.50 more');
    await userEvent.click(within(list).getByRole('link'));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Spent $0.50 more vs Kroger' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Route: Home → Aldi → Walmart → Home')).toBeInTheDocument();
    expect(screen.getByText(/Not counted: birthday candles/)).toBeInTheDocument();
  });

  it('deletes only after confirming', async () => {
    const calls = mockApi({
      ...signedIn(),
      [`GET /trips/${trip.id}`]: { status: 200, body: { trip: detail } },
      [`DELETE /trips/${trip.id}`]: { status: 204 },
      'GET /trips': { status: 200, body: { trips: [], nextCursor: null } },
    });
    const { router } = renderAt(`/trips/${trip.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete trip' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete this trip' }));
    expect(await screen.findByText(/No trips yet/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/trips');
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('rangeFor, foldRows and savedText', () => {
    expect(rangeFor('90d', '2026-11-01')).toEqual({ from: '2026-08-03', to: '2026-11-01' });
    expect(rangeFor('365d', '2026-11-01').from).toBe('2025-11-01');
    const rows = Array.from({ length: 10 }, (_, i) => ({
      key: i,
      label: `S${String(i)}`,
      spentCents: 10,
      savedCents: 10 - i,
      itemCount: 1,
    }));
    const folded = foldRows(rows);
    expect(folded).toHaveLength(8);
    expect(folded.at(-1)).toEqual({
      key: -1,
      label: 'Other',
      spentCents: 30,
      savedCents: 3 + 2 + 1,
      itemCount: 3,
    });
    expect(savedText(125)).toBe('Saved $1.25');
    expect(savedText(-5)).toBe('Spent $0.05 more');
  });
});
