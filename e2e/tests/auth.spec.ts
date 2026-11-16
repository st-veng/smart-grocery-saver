import { expect, test } from '@playwright/test';
import { DEMO, expectNoSeriousA11yViolations, uniqueEmail } from './helpers';

test.describe('auth (Phase 2)', () => {
  test('register → onboarding (ZIP, stores, car) → Lists', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('link', { name: 'Create an account' }).click();
    await page.getByLabel('Your name').fill('Riley Shopper');
    await page.getByLabel('Email').fill(uniqueEmail('riley'));
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Where do you shop from?' }),
    ).toBeVisible();
    await page.getByLabel('Home ZIP code').fill('75034');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Pick your stores' })).toBeVisible();
    // Frisco 75034: nearby chains pre-checked, Trader Joe's (nearest > 7 mi) not; loyalty cards on.
    await expect(page.getByRole('checkbox', { name: /^Walmart/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /^Kroger/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /^Trader Joe's/ })).not.toBeChecked();
    await expect(
      page.getByRole('checkbox', { name: 'Use my Kroger Plus Card prices' }),
    ).toBeChecked();
    await expect(
      page.getByRole('checkbox', { name: 'Use my Tom Thumb for U prices' }),
    ).toBeChecked();
    await page.getByRole('checkbox', { name: 'I have a Costco membership' }).check();
    await expect(page.getByLabel('Your usual store')).toHaveValue(/\d+/);
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Your car' })).toBeVisible();
    await page.getByLabel('Miles per gallon').fill('29');
    await page.getByRole('button', { name: 'Finish setup' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'My Lists' })).toBeVisible();
    await expect(page.getByText('Hi, Riley Shopper!')).toBeVisible();

    // Settings reflect what was chosen.
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: /Settings/ })
      .click();
    await expect(page.getByRole('checkbox', { name: 'I have a Costco membership' })).toBeChecked();
    await expect(page.getByLabel('Car miles per gallon')).toHaveValue('29');
  });

  test('sign out → protected pages redirect to login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(DEMO.email);
    await page.getByLabel('Password').fill(DEMO.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // Demo user is already onboarded: straight to Lists.
    await expect(page.getByText('Hi, Demo Family!')).toBeVisible();
    await page.goto('/settings');
    await expect(page.getByRole('checkbox', { name: 'I have a Costco membership' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /^Sam's Club/ })).toBeChecked();
    await expect(
      page.getByRole('checkbox', { name: "I have a Sam's Club membership" }),
    ).not.toBeChecked();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  });

  test('wrong password shows a generic error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(DEMO.email);
    await page.getByLabel('Password').fill('definitely wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect');
  });

  test('Continue with Google (mock consent) signs in a new user and starts onboarding', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Continue with Google' }).click();
    await expect(page.getByRole('heading', { name: 'Mock Google sign-in' })).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill(uniqueEmail('gwen'));
    await page.getByLabel('Name').fill('Gwen Google');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Where do you shop from?' }),
    ).toBeVisible();
  });

  test('Google with the demo email links to the existing account', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Continue with Google' }).click();
    await page.getByLabel('Email', { exact: true }).fill(DEMO.email);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Hi, Demo Family!')).toBeVisible();
  });
});
