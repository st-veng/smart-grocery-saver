import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const DEMO = { email: 'demo@sgs.test', password: 'demo-password-123' };

/** Sign in through the API; the page's request context shares cookies with the browser. */
export async function signInAsDemo(page: Page): Promise<void> {
  const res = await page.request.post('/api/v1/auth/login', {
    headers: { 'X-Requested-With': 'sgs' },
    data: DEMO,
  });
  expect(res.status()).toBe(200);
}

export async function expectNoSeriousA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)})`)).toEqual([]);
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}
