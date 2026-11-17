import { expect, test, type Page } from '@playwright/test';
import { E2E_ANCHOR } from '../playwright.config';
import { expectNoSeriousA11yViolations, uniqueEmail } from './helpers';

const CSRF = { 'X-Requested-With': 'sgs' };

/** A fresh, onboarded user (home 75034, default stores) — so this spec owns its notifications. */
async function signUpOnboarded(page: Page): Promise<void> {
  const reg = await page.request.post('/api/v1/auth/register', {
    headers: CSRF,
    data: {
      email: uniqueEmail('watcher'),
      password: 'correct horse battery',
      displayName: 'Price Watcher',
    },
  });
  expect(reg.status()).toBe(201);
  const me = await page.request.patch('/api/v1/me', {
    headers: CSRF,
    data: { homeZip: '75034', completeOnboarding: true },
  });
  expect(me.status()).toBe(200);
}

async function productId(page: Page, q: string): Promise<string> {
  const res = await page.request.get(`/api/v1/products?q=${encodeURIComponent(q)}&limit=1`);
  const body = (await res.json()) as { products: { id: string }[] };
  const id = body.products[0]?.id;
  if (!id) throw new Error(`no product for ${q}`);
  return id;
}

const nextDay = (d: string) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

test('price history ranges → create alert → market advances to a 1-year low → bell → notification opens the product', async ({
  page,
}) => {
  await signUpOnboarded(page);
  const honey = await productId(page, 'honey');
  await page.goto(`/products/${honey}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Pure Clover Honey' })).toBeVisible();

  // Each range renders one legend entry per store series from the API, and draws at most 4 lines.
  for (const [label, range] of [
    ['30 days', '30d'],
    ['90 days', '90d'],
    ['1 year', '365d'],
  ] as const) {
    // The radio is visually hidden inside its label (segmented control): click what a person clicks.
    await page
      .locator('label')
      .filter({ has: page.getByRole('radio', { name: label }) })
      .click();
    await expect(page.getByRole('radio', { name: label })).toBeChecked();
    const api = (await (
      await page.request.get(`/api/v1/products/${honey}/history?range=${range}`)
    ).json()) as {
      series: unknown[];
      from: string;
    };
    await expect(
      page.getByRole('list', { name: 'Stores in chart' }).getByRole('listitem'),
    ).toHaveCount(api.series.length);
    await expect(page.getByRole('figure')).toHaveAttribute(
      'data-visible-series',
      String(Math.min(4, api.series.length)),
    );
    await expect(page.locator('.recharts-line')).toHaveCount(Math.min(4, api.series.length));
  }
  await expect(page.getByText(/1-year low:/)).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await page.getByRole('button', { name: /Alert me at a 1-year low/ }).click();
  await expect(page.getByRole('button', { name: /Alerting you at a 1-year low/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('link', { name: 'Notifications' })).toBeVisible();

  // Test hook: the market moves to the planted clearance day (Walmart honey at half price).
  const adv = await page.request.post('/api/v1/test/sim/advance', {
    headers: CSRF,
    data: { to: nextDay(E2E_ANCHOR) },
  });
  expect(adv.status()).toBe(200);

  await page.reload();
  const bell = page.getByRole('link', { name: 'Notifications, 1 unread' });
  await expect(bell).toBeVisible();
  await expect(bell.getByTestId('unread-badge')).toHaveText('1');
  await bell.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
  await expect(page.getByText(/Pure Clover Honey hit a 1-year low at Walmart/)).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole('link', { name: 'View Pure Clover Honey' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pure Clover Honey' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible();
});
