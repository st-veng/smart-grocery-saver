import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11yViolations, signInAsDemo } from './helpers';

// SPEC Phase 3 acceptance: at 360px and in dark mode.
test.use({ viewport: { width: 360, height: 780 }, colorScheme: 'dark' });

async function addViaSearch(page: Page, query: string, option: RegExp, count: number) {
  const box = page.getByRole('combobox', { name: 'Add item' });
  await box.fill(query);
  await page
    .getByRole('listbox', { name: 'Matching products' })
    .getByRole('option', { name: option })
    .first()
    .click();
  await expect(page.getByText(`${String(count)} items · 0 checked`)).toBeVisible();
}

const groupItems = (page: Page, group: string) =>
  page.getByRole('region', { name: group }).getByRole('checkbox');

test.describe('grocery lists (Phase 3)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemo(page);
  });

  test('create → add 5 via search → import → reorder → check off → reload persists', async ({
    page,
  }) => {
    const name = `E2E week ${String(Date.now())}`;
    await page.goto('/');
    await page.getByLabel('New list').fill(name);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

    await addViaSearch(page, 'whole milk', /^Whole Milk/, 1);
    await addViaSearch(page, 'banan', /^Bananas/, 2);
    await addViaSearch(page, 'large eggs', /^Large Grade A Eggs/, 3);
    await addViaSearch(page, 'ground beef', /^80\/20 Ground Beef/, 4);
    await addViaSearch(page, 'white bread', /^White Sandwich Bread/, 5);

    // Import pasted text into the same list.
    await page.getByRole('link', { name: 'Import items' }).click();
    await page
      .getByLabel('Your list, one item per line')
      .fill('2 lb chicken breast\nsalsa x2\ncheese');
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText('2 of 3 matched.', { exact: false })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Product for “cheese”' })).toHaveValue('text');
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('button', { name: 'Add 3 items' }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText('8 items · 0 checked')).toBeVisible();

    // Reorder within the Meat aisle: chicken (imported last) moves above ground beef.
    await expect(groupItems(page, 'Meat')).toHaveCount(2);
    await expect(groupItems(page, 'Meat').first()).toHaveAccessibleName(/80\/20 Ground Beef/);
    await page.getByRole('button', { name: /^Move Boneless Skinless Chicken Breasts up/ }).click();
    await expect(groupItems(page, 'Meat').first()).toHaveAccessibleName(/Chicken Breasts 2 lb/);

    // Check off bananas.
    await page.getByRole('checkbox', { name: /^Bananas/ }).check();
    await expect(page.getByText('8 items · 1 checked')).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // Everything survives a reload.
    await page.reload();
    await expect(page.getByText('8 items · 1 checked')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /^Bananas/ })).toBeChecked();
    await expect(groupItems(page, 'Meat').first()).toHaveAccessibleName(/Chicken Breasts 2 lb/);
    await expect(page.getByRole('checkbox', { name: /^cheese.*not priced/ })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('start a list from a system template', async ({ page }) => {
    await page.goto('/templates');
    await page.getByRole('button', { name: 'Use “Taco night”' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Taco night' })).toBeVisible();
    await expect(page.getByText('12 items · 0 checked')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
