import { expect, test, type Page } from '@playwright/test';
import { CSRF, expectNoSeriousA11yViolations, signUpOnboarded } from './helpers';

interface Plan {
  storeIds: number[];
  route: number[];
  savingsVsBaselineCents: number | null;
}
interface Optimized {
  stores: { id: number; name: string }[];
  single: Plan;
  multi: Plan[];
}

const money = (cents: number) => {
  const abs = Math.abs(cents);
  return `$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
};

async function templateList(page: Page): Promise<string> {
  const t = (await (await page.request.get('/api/v1/templates')).json()) as {
    templates: { id: string }[];
  };
  const res = await page.request.post('/api/v1/lists', {
    headers: CSRF,
    data: { name: 'Big shop', fromTemplateId: t.templates[0]?.id },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { list: { id: string } }).list.id;
}

const totalSaved = async (page: Page) =>
  (
    (await (await page.request.get('/api/v1/dashboard/summary')).json()) as {
      totalSavedCents: number;
    }
  ).totalSavedCents;

test('optimize → choose the multi-store plan → I shopped this → dashboard total increases by the plan’s savings', async ({
  page,
}) => {
  await signUpOnboarded(page, 'planner');
  const listId = await templateList(page);
  // One earlier trip (best single store, a week ago) so the dashboard starts from a non-zero total.
  const oneStore = (await (
    await page.request.post(`/api/v1/lists/${listId}/optimize`, {
      headers: CSRF,
      data: { maxStores: 1 },
    })
  ).json()) as Optimized;
  const weekAgo = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(
    new Date(Date.now() - 7 * 86_400_000),
  );
  const first = await page.request.post('/api/v1/trips', {
    headers: CSRF,
    data: { listId, plan: { storeIds: oneStore.single.storeIds }, shoppedOn: weekAgo },
  });
  expect(first.status()).toBe(201);
  const before = await totalSaved(page);

  await page.goto(`/lists/${listId}/compare`);
  await page.getByRole('link', { name: /Plan my trip/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Plan your trip' })).toBeVisible();

  const api = (await (
    await page.request.post(`/api/v1/lists/${listId}/optimize`, {
      headers: CSRF,
      data: { maxStores: 3 },
    })
  ).json()) as Optimized;
  const multi = api.multi[0];
  expect(multi, 'the template list should have a multi-store plan').toBeDefined();
  if (!multi) return;
  const name = (id: number) => api.stores.find((s) => s.id === id)?.name ?? '';

  const plans = page.getByRole('group', { name: 'Plans' });
  const radios = plans.getByRole('radio');
  await expect(radios).toHaveCount(1 + api.multi.length);
  // The page lists the single-store plan first, then the multi-store plans in API order.
  const multiCard = plans.locator('label').nth(1);
  await expect(multiCard).toContainText(multi.route.map(name).join(' → '));
  await multiCard.click();
  await expect(radios.nth(1)).toBeChecked();
  const route = page.getByRole('region', { name: 'Route and shopping list' });
  await expect(route.getByRole('heading', { level: 3 })).toHaveCount(multi.route.length);
  await expectNoSeriousA11yViolations(page);

  await page.getByRole('button', { name: 'I shopped this' }).click();
  await expect(page.getByText(/^Trip saved:/)).toBeVisible();

  const after = await totalSaved(page);
  expect(after - before).toBe(multi.savingsVsBaselineCents);
  await page.getByRole('link', { name: 'Dashboard', exact: true }).first().click();
  await expect(page.getByTestId('kpi-saved')).toHaveText(money(after));
  await expect(page.getByTestId('kpi-trips')).toHaveText('2');
});
