import { recreateDatabase, testDatabaseUrl } from '@sgs/db/testing';
import { runMigrations } from '@sgs/db';
import { seedDatabase } from '../src/seed/seed.js';

export const TEST_SEED = '20261116';
export const TEST_ANCHOR = '2026-11-01';

/** Seeds sgs_test_pricing once for all DB-backed pricing tests (fixed seed + anchor). */
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl('pricing');
  await recreateDatabase(url);
  await runMigrations(url);
  const result = await seedDatabase({ url, seed: TEST_SEED, anchorDate: TEST_ANCHOR });
  process.env.SGS_TEST_SEED_MS = String(result.ms);
}
