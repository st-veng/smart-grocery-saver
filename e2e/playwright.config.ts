import { defineConfig, devices } from '@playwright/test';

const E2E_DB = process.env.DATABASE_URL_E2E ?? 'postgres://sgs:sgs@localhost:5433/sgs_e2e';
const API_PORT = 4100;
const WEB_PORT = 4173;
export const E2E_ANCHOR = '2026-11-01';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'off' },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @sgs/api start',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: E2E_DB,
        SEED_ANCHOR_DATE: E2E_ANCHOR,
        LOG_LEVEL: 'warn',
        NODE_ENV: 'test',
        WEB_ORIGIN: `http://localhost:${String(WEB_PORT)}`,
        AUTH_GOOGLE_MODE: 'mock',
        AUTH_RATE_LIMIT_SCALE: '50',
      },
    },
    {
      command: 'pnpm --filter @sgs/web build && pnpm --filter @sgs/web preview',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
