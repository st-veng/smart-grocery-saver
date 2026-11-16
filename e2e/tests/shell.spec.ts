import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test.describe('app shell (Phase 1)', () => {
  test('loads, shows API ok from the real API, and the demo-prices banner', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'My Lists' })).toBeVisible();
    await expect(page.getByText('API: ok')).toBeVisible();
    await expect(page.getByRole('note', { name: 'Demo prices' })).toContainText(
      'not real store prices',
    );
    await expectNoSeriousA11yViolations(page);
  });

  test('dark mode toggle applies, persists across reload, and stays accessible', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).not.toHaveClass(/dark/);
    await page.getByRole('button', { name: /Theme: System/ }).click();
    await page.getByRole('button', { name: /Theme: Light/ }).click();
    await expect(html).toHaveClass(/dark/);
    await page.reload();
    await expect(html).toHaveClass(/dark/);
    await expect(page.getByRole('button', { name: /Theme: Dark/ })).toBeVisible();
    await expect(page.getByText('API: ok')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('primary navigation works and the layout has no horizontal scroll', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: /Dashboard/ })
      .click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Savings Dashboard' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the API health endpoints respond through the web proxy', async ({ request }) => {
    const live = await request.get('/api/v1/health');
    expect(live.ok()).toBe(true);
    const ready = await request.get('/api/v1/health/ready');
    expect(ready.status()).toBe(200);
    expect(await ready.json()).toMatchObject({
      status: 'ready',
      priceProvider: 'mock',
      metro: 'DFW',
    });
  });
});
