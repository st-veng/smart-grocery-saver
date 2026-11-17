import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11yViolations, signInAsDemo } from './helpers';

interface Comparison {
  stores: { id: number; name: string }[];
  totals: { storeId: number; totalCents: number; savingsPct: number | null; complete: boolean }[];
  cheapestStoreId: number | null;
  savingsPct: number | null;
  baseline: { storeId: number | null };
}

async function familyWeekId(page: Page): Promise<string> {
  const res = await page.request.get('/api/v1/lists');
  const body = (await res.json()) as { lists: { id: string; name: string }[] };
  const id = body.lists.find((l) => l.name === 'Family week')?.id;
  if (!id) throw new Error('demo Family week list missing');
  return id;
}

const pct = (p: number) => `${(Math.round(Math.abs(p) * 10) / 10).toFixed(1)}%`;

test.describe('price comparison (Phase 4)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemo(page);
  });

  test('list → Compare: cheapest store has a star and text, % matches the API, toggling a store recomputes', async ({
    page,
  }) => {
    const id = await familyWeekId(page);
    const api = (await (
      await page.request.get(`/api/v1/lists/${id}/comparison`)
    ).json()) as Comparison;
    const name = (sid: number | null) => api.stores.find((s) => s.id === sid)?.name ?? '';
    expect(api.cheapestStoreId).not.toBeNull();

    await page.goto(`/lists/${id}`);
    await page.getByRole('link', { name: 'Compare prices' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Compare prices' })).toBeVisible();

    // Cheapest store: ★ icon + visible "Cheapest" text (not colour alone), first in the ranking.
    const totals = page.getByRole('list', { name: 'Store totals, cheapest first' });
    const first = totals.getByRole('listitem').first();
    await expect(first).toContainText(name(api.cheapestStoreId));
    await expect(first).toContainText('★');
    await expect(first).toContainText('Cheapest');
    await expect(page.getByRole('status').filter({ hasText: 'is cheapest' })).toContainText(
      `${name(api.cheapestStoreId)} is cheapest for this list`,
    );

    // Every complete store's % in the UI equals the API's.
    for (const t of api.totals.filter(
      (x) => x.complete && x.savingsPct !== null && x.storeId !== api.baseline.storeId,
    )) {
      const row = totals.locator(`li[data-store="${name(t.storeId)}"]`);
      await expect(row).toContainText(pct(t.savingsPct ?? 0));
    }
    await expectNoSeriousA11yViolations(page);

    // Turn the cheapest store off → a different store becomes cheapest.
    await page.getByRole('checkbox', { name: name(api.cheapestStoreId), exact: true }).uncheck();
    await expect(
      page.getByRole('checkbox', { name: name(api.cheapestStoreId), exact: true }),
    ).not.toBeChecked();
    await expect(totals.locator(`li[data-store="${name(api.cheapestStoreId)}"]`)).toHaveCount(0);
    await expect(totals.getByRole('listitem').first()).toContainText('Cheapest');
    await expect(totals.getByRole('listitem').first()).not.toContainText(name(api.cheapestStoreId));
  });

  test('a product’s prices page lists the lowest unit price first', async ({ page }) => {
    const id = await familyWeekId(page);
    await page.goto(`/lists/${id}/compare`);
    await page.getByRole('link', { name: 'All prices for Whole Milk' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Whole Milk' })).toBeVisible();
    const offers = page.getByRole('list', { name: /Whole Milk prices by store/ });
    await expect(offers.getByRole('listitem').first()).toContainText('Lowest unit price');
    await expect(page.getByText(/Lowest now:/)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('Compare tab lets you pick a list', async ({ page }) => {
    await page.goto('/compare');
    await page.getByRole('link', { name: /Family week/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Compare prices' })).toBeVisible();
  });
});
