import { databaseUrl, loadRootEnv } from '@sgs/db';
import { seedDatabase } from '../seed/seed.js';

loadRootEnv();
const result = await seedDatabase({
  url: databaseUrl(),
  seed: process.env.SEED || undefined,
  anchorDate: process.env.SEED_ANCHOR_DATE || undefined,
  demoPassword: process.env.DEMO_USER_PASSWORD || undefined,
  log: (m) => {
    console.log(m);
  },
});
console.log(
  `seeded ${new URL(databaseUrl()).pathname.slice(1)}: ${result.stores} stores, ${result.locations} locations, ` +
    `${result.products} products, ${result.itemsUpserted} store items (${result.matched} matched, ` +
    `${result.unmatched} unmatched, ${result.unparseable} unparseable), ${result.pricePointsWritten} price periods ` +
    `in ${(result.ms / 1000).toFixed(1)}s`,
);
