import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { CSRF, expectNoSeriousA11yViolations, signUpOnboarded } from './helpers';

interface Trip {
  id: string;
  savingsCents: number;
}
interface Summary {
  tripCount: number;
  totalSavedCents: number;
  avgSavingsPct: number | null;
  bestStore: { name: string } | null;
}

const money = (cents: number) => {
  const abs = Math.abs(cents);
  return `$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
};
const chicago = (offsetDays = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );

/** A list made from the first system template, owned by this spec's fresh user. */
async function templateList(page: Page): Promise<string> {
  const t = (await (await page.request.get('/api/v1/templates')).json()) as {
    templates: { id: string }[];
  };
  const res = await page.request.post('/api/v1/lists', {
    headers: CSRF,
    data: { name: 'Dashboard run', fromTemplateId: t.templates[0]?.id },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { list: { id: string } }).list.id;
}

const tripsNow = async (page: Page) =>
  ((await (await page.request.get('/api/v1/trips')).json()) as { trips: Trip[] }).trips;

/** WCAG relative-luminance contrast between two CSS rgb() colours. */
function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const [r = 0, g = 0, bl = 0] = (c.match(/\d+(\.\d+)?/g) ?? []).map(Number);
    const ch = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(bl);
  };
  const [hi = 0, lo = 0] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('commit 2 trips → dashboard KPIs match → download CSV and PDF → charts readable in dark mode', async ({
  page,
}) => {
  await signUpOnboarded(page, 'saver');
  const listId = await templateList(page);
  await page.goto(`/lists/${listId}/compare`);
  const log = page.getByRole('region', { name: 'I shopped this' });
  await expect(log).toBeVisible();

  // Trip 1: today at the pre-selected cheapest store.
  await log.getByRole('button', { name: 'Save trip' }).click();
  await expect(log.getByRole('status')).toContainText('Trip saved');
  await expect.poll(async () => (await tripsNow(page)).length).toBe(1);

  // Trip 2: yesterday, at the two cheapest stores.
  await log.getByRole('checkbox').nth(1).check();
  await log.getByLabel('Date shopped').fill(chicago(-1));
  await log.getByRole('button', { name: 'Save trip' }).click();
  await expect.poll(async () => (await tripsNow(page)).length).toBe(2);

  const trips = await tripsNow(page);
  const saved = trips.reduce((a, t) => a + t.savingsCents, 0);
  const api = (await (await page.request.get('/api/v1/dashboard/summary')).json()) as Summary;
  expect(api.tripCount).toBe(2);
  expect(api.totalSavedCents).toBe(saved);

  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: /Dashboard/ })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Savings' })).toBeVisible();
  await expect(page.getByTestId('kpi-trips')).toHaveText('2');
  await expect(page.getByTestId('kpi-saved')).toHaveText(money(saved));
  await expect(page.getByTestId('kpi-pct')).toHaveText(
    api.avgSavingsPct === null ? '—' : `${api.avgSavingsPct.toFixed(1)}%`,
  );
  await expect(page.getByTestId('kpi-best')).toHaveText(api.bestStore?.name ?? '—');
  await expectNoSeriousA11yViolations(page);

  // Exports: real downloads, non-empty, the right formats, and they contain both trips.
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download CSV' }).click(),
  ]);
  expect(csv.suggestedFilename()).toMatch(/^savings-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
  const csvText = await readFile(await csv.path(), 'utf8');
  expect(csvText.replace(String.fromCharCode(0xfeff), '').startsWith('Date,Trip ID,List')).toBe(
    true,
  );
  for (const t of trips) expect(csvText).toContain(t.id);

  const [pdf] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download PDF' }).click(),
  ]);
  const pdfBytes = await readFile(await pdf.path());
  expect(pdfBytes.length).toBeGreaterThan(1000);
  expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');

  // Dark mode (theme follows the system): charts render, and their text is readable on the card.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  const over = page.getByRole('figure', { name: 'Saved per month' });
  await expect(over).toBeVisible();
  await expect(over.locator('.recharts-bar-rectangle path').first()).toBeVisible();
  const where = page.getByRole('figure', { name: /Saved by store/ });
  await expect(where.locator('.recharts-bar-rectangle path').first()).toBeVisible();
  const colours = await page.evaluate(() => {
    const css = (sel: string, prop: 'fill' | 'backgroundColor') => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el)[prop] : '';
    };
    return {
      bg: css('[aria-labelledby="time-h"]', 'backgroundColor'),
      tick: css('figure .recharts-cartesian-axis-tick-value', 'fill'),
      label: css('figure .recharts-label-list text', 'fill'),
    };
  });
  expect(contrast(colours.tick, colours.bg)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(colours.label, colours.bg)).toBeGreaterThanOrEqual(4.5);
  await expectNoSeriousA11yViolations(page);
});
