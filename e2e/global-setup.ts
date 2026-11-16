import { resetDatabase } from '@sgs/db';
import { seedDatabase } from '@sgs/pricing';

/** Fresh, seeded e2e database (fixed seed + anchor) before the servers start serving tests. */
export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL_E2E ?? 'postgres://sgs:sgs@localhost:5433/sgs_e2e';
  await resetDatabase(url);
  await seedDatabase({ url, seed: '20261116', anchorDate: '2026-11-01' });
}
