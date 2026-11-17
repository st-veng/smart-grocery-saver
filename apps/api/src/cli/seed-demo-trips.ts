/**
 * Dev only: give the demo user a year of committed trips so the dashboard has something to show.
 * Runs after `pnpm db:seed` (chained by the root script). Uses the real trip service, so every trip
 * is priced from history on the day "shopped". Skips if the demo user already has trips.
 */
import { addDays, DEFAULT_ORIGIN } from '@sgs/core';
import { createDb, groceryLists, trips, users } from '@sgs/db';
import { DEMO_EMAIL, marketDates } from '@sgs/pricing';
import { and, eq } from 'drizzle-orm';
import { compareListForUser } from '../services/compare.js';
import { commitTrip } from '../services/trips.js';

const url = process.env.DATABASE_URL ?? 'postgres://sgs:sgs@localhost:5433/sgs_dev';
const handle = createDb(url);
const { db } = handle;
try {
  const [demo] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_EMAIL));
  if (!demo) throw new Error('Demo user not found: run pnpm db:seed first');
  const [list] = await db
    .select({ id: groceryLists.id })
    .from(groceryLists)
    .where(and(eq(groceryLists.userId, demo.id), eq(groceryLists.name, 'Family week')));
  if (!list) throw new Error('Demo list "Family week" not found');
  if ((await db.select({ id: trips.id }).from(trips).where(eq(trips.userId, demo.id))).length) {
    console.log('demo trips: already present, skipped');
  } else {
    const { current } = await marketDates(db);
    if (current === null) throw new Error('No market data: run pnpm db:seed first');
    const opts = {
      radiusMiles: Number(process.env.PRESELECT_RADIUS_MILES ?? 7),
      metro: process.env.METRO ?? 'DFW',
    };
    let n = 0;
    // Roughly two trips a month for a year: mostly the cheapest store, sometimes a two-store run,
    // and now and then the baseline store itself (fuel makes that a small negative saving).
    for (let k = 23; k >= 0; k--) {
      const day = addDays(current, -k * 15 - 2);
      const cmp = await compareListForUser(db, demo.id, list.id, { asOf: day, ...opts });
      const complete = cmp.totals
        .filter((t) => t.complete)
        .sort((a, b) => a.totalCents - b.totalCents);
      const cheapest = complete[0]?.storeId;
      const second = complete[1]?.storeId;
      const baseline = cmp.baseline.storeId;
      if (cheapest === undefined || baseline === null) continue;
      const storeIds =
        k % 7 === 3
          ? [baseline]
          : k % 4 === 1 && second !== undefined
            ? [cheapest, second]
            : [cheapest];
      await commitTrip(
        db,
        demo.id,
        { listId: list.id, plan: { storeIds }, shoppedOn: day },
        {
          today: current,
          ...opts,
          defaultOrigin: DEFAULT_ORIGIN,
          fuelCentsPerGalDefault: Number(process.env.FUEL_CENTS_PER_GAL_DEFAULT ?? 279),
        },
      );
      n++;
    }
    console.log(`demo trips: ${String(n)} committed through ${current}`);
  }
} finally {
  await handle.close();
}
