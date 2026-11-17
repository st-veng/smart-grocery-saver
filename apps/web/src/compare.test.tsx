import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAt, signedIn } from './test-utils';

const LIST_ID = '22222222-2222-4222-8222-222222222222';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const store = (id: number, slug: string, name: string, extra: object = {}) => ({
  id,
  slug,
  name,
  brandColor: '#000000',
  requiresMembership: false,
  loyaltyProgram: null,
  ...extra,
});
const STORES = [
  store(1, 'walmart', 'Walmart'),
  store(3, 'sams', "Sam's Club", { requiresMembership: true }),
  store(5, 'kroger', 'Kroger'),
  store(7, 'aldi', 'Aldi'),
];
const MILK = {
  id: uuid(1),
  slug: 'whole-milk',
  name: 'Whole Milk',
  categoryId: 2,
  categoryName: 'Dairy',
  dimension: 'volume',
  displayUnit: 'fl_oz',
  defaultQuantity: 1,
  defaultUnit: 'gal',
  avgEachGrams: null,
};
const at = (storeId: number, lineCents: number | null, extra: object = {}) => ({
  storeId,
  status: lineCents === null ? 'missing' : 'ok',
  storeItemId: lineCents === null ? null : uuid(200 + storeId),
  title: lineCents === null ? null : `Milk at ${String(storeId)}`,
  brand: null,
  packages: lineCents === null ? null : 2,
  lineCents,
  unitPriceCents: lineCents === null ? null : lineCents / 256,
  onSale: false,
  memberPrice: false,
  promoLabel: null,
  usedMultiBuy: false,
  approximate: false,
  overbuy: 0,
  ...extra,
});

function comparison(included: number[]) {
  const totals = [
    {
      storeId: 1,
      totalCents: 1732,
      pricedCount: 1,
      missingCount: 0,
      complete: true,
      savingsCents: 146,
      savingsPct: 7.8,
    },
    {
      storeId: 5,
      totalCents: 1878,
      pricedCount: 1,
      missingCount: 0,
      complete: true,
      savingsCents: 0,
      savingsPct: 0,
    },
    {
      storeId: 7,
      totalCents: 1271,
      pricedCount: 0,
      missingCount: 1,
      complete: false,
      savingsCents: null,
      savingsPct: null,
    },
  ].filter((t) => included.includes(t.storeId));
  const cheapest = included.includes(1) ? 1 : included.includes(5) ? 5 : null;
  return {
    listId: LIST_ID,
    listName: 'Family week',
    asOf: '2026-11-01',
    stores: STORES,
    available: [1, 5, 7].map((id) => ({ storeId: id, included: included.includes(id) })),
    excluded: [
      { storeId: 3, reason: 'no_membership' },
      ...[1, 5, 7]
        .filter((id) => !included.includes(id))
        .map((id) => ({ storeId: id, reason: 'not_selected' })),
    ],
    totals,
    lines: [
      {
        itemId: uuid(100),
        rawText: 'Whole Milk',
        product: MILK,
        quantity: 2,
        unit: 'gal',
        checked: false,
        unpriced: false,
        need: 256,
        stores: [
          at(1, 1732),
          at(5, 1878, { onSale: true, memberPrice: true, promoLabel: 'Card price', overbuy: 128 }),
          at(7, null),
        ].filter((s) => included.includes(s.storeId)),
        cheapestStoreIds: cheapest === null ? [] : [cheapest],
      },
      {
        itemId: uuid(101),
        rawText: 'birthday candles',
        product: null,
        quantity: 1,
        unit: null,
        checked: false,
        unpriced: true,
        need: null,
        stores: [],
        cheapestStoreIds: [],
      },
    ],
    cheapestStoreId: cheapest,
    cheapestWithMissingStoreId: cheapest,
    baseline: { storeId: 5, source: 'user', totalCents: 1878 },
    savingsPct: cheapest === 1 ? 7.8 : 0,
    savingsCents: cheapest === 1 ? 146 : 0,
    unpricedCount: 1,
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
});

describe('compare page', () => {
  it('ranks stores, marks the cheapest with a star AND text, and states the saving vs the usual store', async () => {
    mockApi({
      ...signedIn(),
      [`GET /lists/${LIST_ID}/comparison`]: { status: 200, body: comparison([1, 5, 7]) },
    });
    renderAt(`/lists/${LIST_ID}/compare`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Compare prices' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Walmart is cheapest for this list: save $1.46 (7.8%) vs Kroger.',
    );
    const rows = within(
      screen.getByRole('list', { name: 'Store totals, cheapest first' }),
    ).getAllByRole('listitem');
    expect(rows.map((r) => r.dataset.store)).toEqual(['Walmart', 'Kroger', 'Aldi']);
    expect(rows[0]).toHaveTextContent(/Walmart.*Cheapest.*\$17\.32.*Save \$1\.46 \(7\.8%\)/);
    expect(rows[1]).toHaveTextContent(/Kroger.*usual store.*\$18\.78/);
    expect(rows[2]).toHaveTextContent(/Aldi.*1 item missing/);
    expect(screen.getByText('Not shown (no membership):', { exact: false })).toHaveTextContent(
      "Sam's Club",
    );
    expect(
      screen.getByText(/Not priced \(no matching product\): birthday candles/),
    ).toBeInTheDocument();
  });

  it('shows per-item store prices with unit price, sale/card badges, extra quantity and "Not carried"', async () => {
    mockApi({
      ...signedIn(),
      [`GET /lists/${LIST_ID}/comparison`]: { status: 200, body: comparison([1, 5, 7]) },
    });
    renderAt(`/lists/${LIST_ID}/compare`);
    const milk = await screen.findByRole('list', { name: 'Whole Milk by store' });
    const rows = within(milk).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(/Walmart.*Cheapest.*\$17\.32.*2 pkg · 6\.8¢\/fl oz/);
    expect(rows[1]).toHaveTextContent(/Kroger.*\$18\.78.*Card price.*\+128 fl oz extra/);
    expect(rows[2]).toHaveTextContent(/Aldi.*Not carried/);
    expect(screen.getByRole('link', { name: 'All prices for Whole Milk' })).toHaveAttribute(
      'href',
      `/products/${uuid(1)}`,
    );
  });

  it('toggling a store off asks the API again without it', async () => {
    const calls = mockApi({
      ...signedIn(),
      [`GET /lists/${LIST_ID}/comparison`]: (c) => {
        const m = /stores=([\d,]+)/.exec(c.url);
        return { status: 200, body: comparison(m?.[1] ? m[1].split(',').map(Number) : [1, 5, 7]) };
      },
    });
    renderAt(`/lists/${LIST_ID}/compare`);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Walmart' }));
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Walmart' })).not.toBeChecked();
    });
    expect(calls.filter((c) => c.path.endsWith('/comparison')).at(-1)?.url).toContain(
      '?stores=5,7',
    );
    const rows = within(
      screen.getByRole('list', { name: 'Store totals, cheapest first' }),
    ).getAllByRole('listitem');
    expect(rows.map((r) => r.dataset.store)).toEqual(['Kroger', 'Aldi']);
    expect(rows[0]).toHaveTextContent(/Kroger.*Cheapest/);
    // At least one store must stay selected.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Aldi' }));
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Kroger' })).toBeDisabled();
    });
  });
});

describe('product page', () => {
  it('lists offers with the lowest unit price starred', async () => {
    mockApi({
      ...signedIn(),
      [`GET /products/${uuid(1)}/offers`]: {
        status: 200,
        body: {
          product: MILK,
          asOf: '2026-11-01',
          stores: STORES,
          offers: [
            {
              storeId: 5,
              storeItemId: uuid(301),
              title: 'Kroger Whole Milk',
              brand: 'Kroger',
              isStoreBrand: true,
              priceCents: 299,
              regularPriceCents: 389,
              perWeight: false,
              sizeLabel: '1 gal',
              unitPriceCents: 2.336,
              onSale: true,
              memberPrice: true,
              promoLabel: 'Card price',
              approximate: false,
              cheapest: true,
            },
            {
              storeId: 1,
              storeItemId: uuid(302),
              title: 'Great Value Whole Milk',
              brand: 'Great Value',
              isStoreBrand: true,
              priceCents: 329,
              regularPriceCents: 329,
              perWeight: false,
              sizeLabel: '1 gal',
              unitPriceCents: 2.57,
              onSale: false,
              memberPrice: false,
              promoLabel: null,
              approximate: false,
              cheapest: false,
            },
          ],
        },
      },
    });
    renderAt(`/products/${uuid(1)}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Whole Milk' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Lowest now:/)).toHaveTextContent('Lowest now: Kroger at 2.3¢/fl oz');
    const items = within(
      screen.getByRole('list', { name: /Whole Milk prices by store/ }),
    ).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(
      /Kroger.*Lowest unit price.*\$2\.99.*Card price \(reg\. \$3\.89\)/,
    );
    expect(items[1]).not.toHaveTextContent('Lowest unit price');
  });
});
