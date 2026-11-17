/**
 * pnpm sim:advance [--days N | --to YYYY-MM-DD]
 * Replays the mock provider forward from the latest ingested market date, evaluating alerts each day.
 */
import { addDays, isIsoDate } from '@sgs/core';
import { createDb, databaseUrl, loadRootEnv } from '@sgs/db';
import { advanceTo, marketDates } from '../history/sim.js';
import { MockPriceProvider } from '../mock/mock-provider.js';
import { DEFAULT_SEED } from '../seed/seed.js';

loadRootEnv();
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const handle = createDb(databaseUrl());
try {
  const { anchor, current } = await marketDates(handle.db);
  if (!anchor || !current) throw new Error('No seeded market data. Run `pnpm db:seed` first.');
  const to = flag('--to');
  const days = Number(flag('--days') ?? '1');
  if (to !== undefined && !isIsoDate(to)) throw new Error('--to must be YYYY-MM-DD');
  if (to === undefined && !(Number.isInteger(days) && days >= 1 && days <= 366))
    throw new Error('--days must be 1–366');
  const target = to ?? addDays(current, days);
  const provider = new MockPriceProvider({
    seed: process.env.SEED || DEFAULT_SEED,
    anchorDate: anchor,
  });
  const r = await advanceTo(handle.db, provider, target);
  console.log(
    `market date ${r.from} → ${r.to} (${String(r.applied.length)} day(s) ingested), ` +
      `${String(r.notificationsCreated)} notification(s) created`,
  );
} finally {
  await handle.close();
}
