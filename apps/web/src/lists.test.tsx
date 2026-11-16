import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAt, signedIn } from './test-utils';

const LIST_ID = '22222222-2222-4222-8222-222222222222';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

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
const BANANAS = {
  ...MILK,
  id: uuid(2),
  slug: 'bananas',
  name: 'Bananas',
  categoryId: 1,
  categoryName: 'Produce',
  dimension: 'mass',
  displayUnit: 'lb',
  defaultUnit: 'lb',
};

const item = (n: number, product: typeof MILK | null, extra: object = {}) => ({
  id: uuid(100 + n),
  position: n,
  rawText: product?.name ?? 'candles',
  product,
  quantity: 1,
  unit: null,
  matchMode: 'any',
  brand: null,
  storeItemId: null,
  categoryId: product?.categoryId ?? null,
  categoryOverride: false,
  checked: false,
  notes: null,
  ...extra,
});

const LIST = {
  id: LIST_ID,
  name: 'This week',
  description: null,
  isTemplate: false,
  system: false,
  archived: false,
  itemCount: 4,
  checkedCount: 0,
  updatedAt: '2026-11-16T12:00:00.000Z',
  groups: [
    {
      categoryId: 1,
      categoryName: 'Produce',
      items: [item(0, BANANAS, { quantity: 3, unit: 'lb' })],
    },
    {
      categoryId: 2,
      categoryName: 'Dairy',
      items: [
        item(1, MILK, { quantity: 2 }),
        item(3, { ...MILK, id: uuid(4), slug: 'eggs', name: 'Eggs' }),
      ],
    },
    { categoryId: null, categoryName: 'Other', items: [item(2, null)] },
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

const withList = (extra: Parameters<typeof mockApi>[0] = {}) =>
  mockApi({
    ...signedIn(),
    [`GET /lists/${LIST_ID}`]: { status: 200, body: { list: LIST } },
    ...extra,
  });

describe('lists home', () => {
  it('shows lists and creates a new one', async () => {
    const calls = mockApi({
      ...signedIn(),
      'GET /lists': {
        status: 200,
        body: { lists: [{ ...LIST, groups: undefined }], nextCursor: null },
      },
      'POST /lists': {
        status: 201,
        body: { list: { ...LIST, id: uuid(9), name: 'Party', itemCount: 0, groups: [] } },
      },
      [`GET /lists/${uuid(9)}`]: {
        status: 200,
        body: { list: { ...LIST, id: uuid(9), name: 'Party', itemCount: 0, groups: [] } },
      },
    });
    const { router } = renderAt('/');
    expect(await screen.findByRole('link', { name: /This week/ })).toHaveTextContent('4 items');
    await userEvent.type(screen.getByLabelText('New list'), 'Party');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/lists/${uuid(9)}`);
    });
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Party' });
  });
});

describe('list detail', () => {
  it('shows items grouped by aisle with quantities and an unpriced badge', async () => {
    withList();
    renderAt(`/lists/${LIST_ID}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'This week' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Produce',
      'Dairy',
      'Other',
    ]);
    expect(screen.getByRole('checkbox', { name: /Bananas 3 lb/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Whole Milk 2 × 1 gal/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /candles.*not priced/ })).toBeInTheDocument();
  });

  it('typeahead: arrow + Enter adds the chosen product; Enter on plain text adds free text', async () => {
    const calls = withList({
      'GET /products': {
        status: 200,
        body: {
          products: [
            MILK,
            { ...MILK, id: uuid(3), slug: '2-percent', name: '2% Reduced Fat Milk' },
          ],
          nextCursor: null,
        },
      },
      [`POST /lists/${LIST_ID}/items`]: { status: 201, body: { item: item(5, MILK) } },
    });
    renderAt(`/lists/${LIST_ID}`);
    const box = await screen.findByRole('combobox', { name: 'Add item' });
    await userEvent.type(box, 'milk');
    const listbox = await screen.findByRole('listbox', { name: 'Matching products' });
    expect(within(listbox).getAllByRole('option')).toHaveLength(2);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await userEvent.type(box, '2 lb ground beef{Enter}');
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
    });
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { rawText: '2% Reduced Fat Milk', productId: uuid(3) },
      { rawText: '2 lb ground beef' },
    ]);
  });

  it('checks items off and moves them in display order', async () => {
    let checked = false;
    const current = () => ({
      ...LIST,
      groups: LIST.groups.map((g) => ({
        ...g,
        items: g.items.map((i) => (i.id === uuid(100) ? { ...i, checked } : i)),
      })),
    });
    const calls = withList({
      [`GET /lists/${LIST_ID}`]: () => ({ status: 200, body: { list: current() } }),
      [`PATCH /lists/${LIST_ID}/items/${uuid(100)}`]: () => {
        checked = true;
        return { status: 200, body: { item: item(0, BANANAS, { checked: true }) } };
      },
      [`PUT /lists/${LIST_ID}/items/order`]: { status: 200, body: { list: LIST } },
    });
    renderAt(`/lists/${LIST_ID}`);
    await userEvent.click(await screen.findByRole('checkbox', { name: /Bananas/ }));
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /Bananas/ })).toBeChecked();
    });
    // Bananas is alone in Produce: nothing to swap with.
    expect(screen.getByRole('button', { name: 'Move Bananas up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Bananas down' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move Eggs up' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PUT')).toBe(true);
    });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ checked: true });
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      itemIds: [uuid(100), uuid(103), uuid(101), uuid(102)],
    });
  });

  it('edits quantity and unit with only units that fit the product', async () => {
    const calls = withList({
      [`PATCH /lists/${LIST_ID}/items/${uuid(101)}`]: {
        status: 200,
        body: { item: item(1, MILK) },
      },
    });
    renderAt(`/lists/${LIST_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Whole Milk' }));
    const unit = screen.getByRole('combobox', { name: 'Unit' });
    expect(
      within(unit)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['packages (1 gal)', 'gal', 'qt', 'pt', 'fl oz', 'L', 'mL']);
    await userEvent.clear(screen.getByLabelText('Quantity'));
    await userEvent.type(screen.getByLabelText('Quantity'), '1.5');
    await userEvent.selectOptions(unit, 'gal');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
    });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      quantity: 1.5,
      notes: null,
      unit: 'gal',
      brand: null,
    });
  });

  it('shows a friendly message for a list that does not exist (or is someone else’s)', async () => {
    mockApi({
      ...signedIn(),
      [`GET /lists/${LIST_ID}`]: {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'List not found' } },
      },
    });
    renderAt(`/lists/${LIST_ID}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('That list does not exist.');
  });
});

describe('import', () => {
  it('previews, keeps ambiguous lines as text unless chosen, skips on request, and commits the reviewed lines', async () => {
    const calls = withList({
      'POST /imports/preview': {
        status: 200,
        body: {
          format: 'text',
          errors: [{ lineNo: 4, message: 'Could not read "42"' }],
          lines: [
            {
              lineNo: 1,
              raw: '2 gal milk',
              name: 'milk',
              quantity: 2,
              unit: 'gal',
              brand: null,
              notes: null,
              status: 'matched',
              productId: MILK.id,
              candidates: [{ productId: MILK.id, name: 'Whole Milk', score: 1 }],
            },
            {
              lineNo: 2,
              raw: 'cheese',
              name: 'cheese',
              quantity: 1,
              unit: null,
              brand: null,
              notes: null,
              status: 'ambiguous',
              productId: null,
              candidates: [
                { productId: uuid(7), name: 'Cream Cheese', score: 0.5 },
                { productId: uuid(8), name: 'Shredded Cheddar Cheese', score: 0.45 },
              ],
            },
            {
              lineNo: 3,
              raw: 'candles',
              name: 'candles',
              quantity: 1,
              unit: null,
              brand: null,
              notes: null,
              status: 'unmatched',
              productId: null,
              candidates: [],
            },
          ],
        },
      },
      'POST /imports/commit': { status: 201, body: { list: LIST } },
    });
    const { router } = renderAt(`/lists/${LIST_ID}/import`);
    await userEvent.type(
      await screen.findByLabelText('Your list, one item per line'),
      '2 gal milk{Enter}cheese{Enter}candles{Enter}42',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('1 of 3 matched.', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Lines we could not read' })).toHaveTextContent(
      'Line 4: Could not read "42"',
    );
    const cheese = screen.getByRole('combobox', { name: 'Product for “cheese”' });
    expect(cheese).toHaveValue('text'); // never auto-picked
    await userEvent.selectOptions(cheese, uuid(8));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Product for “candles”' }),
      'skip',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add 2 items' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/lists/${LIST_ID}`);
    });
    expect(calls.find((c) => c.path === '/imports/commit')?.body).toEqual({
      listId: LIST_ID,
      lines: [
        {
          raw: '2 gal milk',
          productId: MILK.id,
          quantity: 2,
          unit: 'gal',
          brand: null,
          notes: null,
        },
        { raw: 'cheese', productId: uuid(8), quantity: 1, unit: null, brand: null, notes: null },
      ],
    });
  });
});

describe('templates', () => {
  it('previews a template and creates a list from it', async () => {
    const tpl = {
      ...LIST,
      id: uuid(50),
      name: 'Taco night',
      isTemplate: true,
      system: true,
      description: 'Tacos for four.',
      itemCount: 2,
    };
    const calls = mockApi({
      ...signedIn(),
      'GET /templates': { status: 200, body: { templates: [{ ...tpl, groups: undefined }] } },
      [`GET /templates/${uuid(50)}`]: { status: 200, body: { list: tpl } },
      'POST /lists': { status: 201, body: { list: { ...LIST, id: uuid(51), name: 'Taco night' } } },
      [`GET /lists/${uuid(51)}`]: {
        status: 200,
        body: { list: { ...LIST, id: uuid(51), name: 'Taco night' } },
      },
    });
    const { router } = renderAt('/templates');
    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('list', { name: 'Taco night items' })).toHaveTextContent(
      'Bananas',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Use “Taco night”' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/lists/${uuid(51)}`);
    });
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Taco night',
      fromTemplateId: uuid(50),
    });
  });
});
