import { todayIn, type IsoDate } from '@sgs/core';
import { createDb } from '@sgs/db';
import { sql } from 'drizzle-orm';
import { fullSync, type SyncSummary } from '../ingest/ingest.js';
import { MockPriceProvider } from '../mock/mock-provider.js';
import { seedCatalog } from './catalog-seed.js';
import { DEFAULT_DEMO_PASSWORD, seedDemoUser } from './demo-user.js';

export const HISTORY_DAYS = 365;
export const DEFAULT_SEED = '20261116';

export interface SeedOptions {
  readonly url: string;
  readonly seed?: string;
  readonly anchorDate?: IsoDate;
  /** Seed the dev/e2e demo user (default true). */
  readonly demoUser?: boolean;
  readonly demoPassword?: string;
  readonly log?: (msg: string) => void;
}

export interface SeedResult extends SyncSummary {
  readonly anchorDate: IsoDate;
  readonly seed: string;
  readonly products: number;
  readonly categories: number;
  readonly aliases: number;
  readonly ms: number;
}

const APP_TABLES = [
  'trip_items',
  'trips',
  'notifications',
  'price_alerts',
  'list_items',
  'grocery_lists',
  'price_points',
  'provider_sync_runs',
  'store_items',
  'product_aliases',
  'products',
  'categories',
  'user_stores',
  'sessions',
  'auth_identities',
  'users',
  'store_locations',
  'stores',
];

/** Wipe all app data and seed catalog + 12 months of mock prices via the real ingestion pipeline. */
export async function seedDatabase(opts: SeedOptions): Promise<SeedResult> {
  const started = Date.now();
  const seed = opts.seed ?? DEFAULT_SEED;
  const anchorDate = opts.anchorDate ?? todayIn();
  const log = opts.log ?? (() => undefined);
  const handle = createDb(opts.url, { max: 4 });
  try {
    const { db } = handle;
    await db.execute(sql.raw(`TRUNCATE ${APP_TABLES.join(', ')} RESTART IDENTITY CASCADE`));
    const catalog = await seedCatalog(db);
    log(
      `catalog: ${catalog.categories} categories, ${catalog.products} products, ${catalog.aliases} aliases`,
    );
    const provider = new MockPriceProvider({ seed, anchorDate });
    log(`mock provider: seed ${seed}, anchor ${anchorDate}, ${HISTORY_DAYS} days of history`);
    const sync = await fullSync(db, provider, {
      metro: 'DFW',
      anchor: anchorDate,
      days: HISTORY_DAYS,
      log,
    });
    if (opts.demoUser ?? true) {
      const demo = await seedDemoUser(
        db,
        opts.demoPassword ?? DEFAULT_DEMO_PASSWORD,
        new Date(`${anchorDate}T12:00:00Z`),
      );
      log(`demo user: ${demo.email}`);
    }
    return { ...sync, ...catalog, anchorDate, seed, ms: Date.now() - started };
  } finally {
    await handle.close();
  }
}
