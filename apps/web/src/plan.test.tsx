import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verdictText } from './routes/plan';
import { mockApi, renderAt, signedIn } from './test-utils';

const LIST = '33333333-3333-4333-8333-333333333333';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const store = (id: number, name: string) => ({
  id,
  slug: name.toLowerCase(),
  name,
  brandColor: '#000000',
  requiresMembership: false,
  loyaltyProgram: null,
});
const a = (itemId: string, storeId: number, lineCents: number, productName: string) => ({
  itemId,
  rawText: productName.toLowerCase(),
  productName,
  storeId,
  title: `${productName} pack`,
  packages: 1,
  lineCents,
  baselineLineCents: lineCents + 100,
});
const plan = (
  storeIds: number[],
  route: number[],
  assignments: ReturnType<typeof a>[],
  fuel: number,
  extra: object = {},
) => {
  const items = assignments.reduce((t, x) => t + x.lineCents, 0);
  const baseline = assignments.reduce((t, x) => t + x.baselineLineCents, 0);
  return {
    storeIds,
    route,
    assignments,
    missing: [],
    complete: true,
    itemsCents: items,
    distanceMiles: 6.4,
    fuelCents: fuel,
    timeCents: 0,
    totalCents: items + fuel,
    baselineCents: baseline,
    savingsVsBaselineCents: baseline - items - fuel,
    ...extra,
  };
};
const single = plan([1], [1], [a('m', 1, 650, 'Whole Milk'), a('e', 1, 599, 'Large Eggs')], 70);
const multi = plan(
  [1, 7],
  [7, 1],
  [a('m', 7, 300, 'Whole Milk'), a('e', 1, 599, 'Large Eggs')],
  110,
);

function response(over: object = {}) {
  return {
    listId: LIST,
    listName: 'Family week',
    asOf: '2026-11-01',
    maxStores: 3,
    stores: [store(1, 'Walmart'), store(5, 'Kroger'), store(7, 'Aldi')],
    baselineStore: { id: 5, name: 'Kroger' },
    settings: {
      mpg: 25,
      fuelCentsPerGal: 279,
      timeValueCentsPerHour: 0,
      minutesPerStop: 10,
      matchesTrip: true,
    },
    single,
    multi: [multi],
    recommendation: {
      kind: 'multi',
      reason: 'saves_enough',
      extraStopSavingsCents: 310,
      thresholdCents: 300,
    },
    unpriced: [],
    subsetsEvaluated: 7,
    ...over,
  };
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
  localStorage.clear();
});

describe('plan page (S8)', () => {
  it('states the verdict, pre-selects the recommended plan, and logs the chosen plan as a trip', async () => {
    const calls = mockApi({
      ...signedIn(),
      [`POST /lists/${LIST}/optimize`]: { status: 200, body: response() },
      'POST /trips': {
        status: 201,
        body: {
          trip: {
            id: uuid(9),
            listId: LIST,
            listName: 'Family week',
            planType: 'single',
            stores: [{ id: 1, name: 'Walmart' }],
            baselineStore: { id: 5, name: 'Kroger' },
            itemCount: 2,
            itemsTotalCents: 1249,
            fuelCostCents: 70,
            distanceMiles: 6.4,
            baselineTotalCents: 1449,
            savingsCents: 130,
            priceAsOf: '2026-11-01',
            shoppedOn: '2026-11-01',
            createdAt: '2026-11-01T18:00:00.000Z',
            items: [],
            skipped: [],
            mpg: 25,
            fuelCentsPerGal: 279,
          },
        },
      },
    });
    renderAt(`/lists/${LIST}/plan`);
    expect(
      await screen.findByText(
        'The extra stop is worth it: Aldi + Walmart saves $3.10 more than Walmart alone, after fuel.',
      ),
    ).toHaveAttribute('role', 'status');
    const plans = screen.getByRole('group', { name: 'Plans' });
    const radios = within(plans).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[1]).toBeChecked(); // the recommended 2-store plan
    expect(plans).toHaveTextContent(
      /Recommended.*Aldi → Walmart.*\$10\.09.*Save \$0\.90 vs Kroger/s,
    );
    // Route detail follows the chosen plan, in visit order.
    const route = screen.getByRole('region', { name: 'Route and shopping list' });
    expect(
      within(route)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['1. Aldi · 1 item, $3.00', '2. Walmart · 1 item, $5.99']);
    // Choose the single store instead, then log it.
    await userEvent.click(radios[0] as HTMLElement);
    expect(within(route).getAllByRole('heading', { level: 3 })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'I shopped this' }));
    expect(await screen.findByText(/Trip saved: you saved \$1\.30 vs Kroger/)).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.path === '/trips');
    expect(post?.body).toMatchObject({ listId: LIST, plan: { storeIds: [1] } });
  });

  it('stop limit and time cost go to the optimizer', async () => {
    const calls = mockApi({
      ...signedIn(),
      [`POST /lists/${LIST}/optimize`]: { status: 200, body: response() },
    });
    renderAt(`/lists/${LIST}/plan`);
    await screen.findByRole('group', { name: 'Plans' });
    await userEvent.click(screen.getByText('1 store', { selector: 'label' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Count my time' }));
    const bodies = calls.filter((c) => c.path === `/lists/${LIST}/optimize`).map((c) => c.body);
    expect(bodies[0]).toEqual({ maxStores: 3 });
    expect(bodies).toContainEqual({ maxStores: 1 });
    expect(bodies.at(-1)).toEqual({
      maxStores: 1,
      timeValueCentsPerHour: 1500,
      minutesPerStop: 10,
    });
    expect(JSON.parse(localStorage.getItem('sgs-plan-time') ?? '{}')).toMatchObject({ on: true });
  });

  it('empty and error states', async () => {
    mockApi({
      ...signedIn(),
      [`POST /lists/${LIST}/optimize`]: {
        status: 200,
        body: response({
          single: plan([], [], [], 0, { distanceMiles: 0 }),
          multi: [],
          recommendation: {
            kind: 'single',
            reason: 'only_option',
            extraStopSavingsCents: null,
            thresholdCents: 300,
          },
        }),
      },
    });
    renderAt(`/lists/${LIST}/plan`);
    expect(await screen.findByText(/Nothing on this list can be priced/)).toBeInTheDocument();
    vi.unstubAllGlobals();
    mockApi({
      ...signedIn(),
      [`POST /lists/${LIST}/optimize`]: {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'List not found' } },
      },
    });
    renderAt(`/lists/${LIST}/plan`);
    expect(await screen.findByRole('alert')).toHaveTextContent('List not found');
  });
});

describe('verdictText', () => {
  const name = (id: number) => ({ 1: 'Walmart', 7: 'Aldi' })[id] ?? '?';
  it('explains each recommendation in words', () => {
    const r = response();
    const notWorth = {
      ...r,
      recommendation: {
        kind: 'single',
        reason: 'not_worth_it',
        extraStopSavingsCents: 120,
        thresholdCents: 300,
      },
    } as Parameters<typeof verdictText>[0];
    expect(verdictText(notWorth, name)).toBe(
      'One store is enough: a second stop would save only $1.20 after fuel (we suggest it from $3.00).',
    );
    const costsMore = {
      ...notWorth,
      recommendation: { ...notWorth.recommendation, extraStopSavingsCents: -50 },
    };
    expect(verdictText(costsMore, name)).toBe(
      'One store is enough: a second stop would cost more after fuel.',
    );
    const coverage = {
      ...r,
      single: {
        ...single,
        missing: [
          { itemId: 'x', rawText: 'x' },
          { itemId: 'y', rawText: 'y' },
        ],
      },
      recommendation: {
        kind: 'multi',
        reason: 'coverage',
        extraStopSavingsCents: -10,
        thresholdCents: 300,
      },
    } as Parameters<typeof verdictText>[0];
    expect(verdictText(coverage, name)).toBe(
      'Go to Aldi + Walmart: together they have 2 more items than any one store.',
    );
  });
});
