/** Phase 5 acceptance: alert evaluation and the market simulator against a freshly seeded database. */
import { addDays, DEFAULT_ORIGIN } from '@sgs/core';
import {
  createDb,
  notifications,
  priceAlerts,
  products,
  runMigrations,
  stores,
  users,
  userStores,
  type DbHandle,
} from '@sgs/db';
import { recreateDatabase, testDatabaseUrl } from '@sgs/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLANTED_LOWS } from './catalog/planted.js';
import { evaluateAlerts, type AlertPayload } from './history/alerts.js';
import { advanceTo, marketDates } from './history/sim.js';
import { MockPriceProvider } from './mock/mock-provider.js';
import { seedDatabase } from './seed/seed.js';

const SEED = '20261116';
const ANCHOR = '2026-11-01';
const PLANT = PLANTED_LOWS[0];
let h: DbHandle;
let provider: MockPriceProvider;
let honeyId: string;
let walmartId: number;

async function user(label: string): Promise<string> {
  const [u] = await h.db
    .insert(users)
    .values({
      email: `${label}@alerts.test`,
      displayName: label,
      homeZip: '75034',
      homeLat: DEFAULT_ORIGIN.lat,
      homeLng: DEFAULT_ORIGIN.lng,
    })
    .returning({ id: users.id });
  if (!u) throw new Error('insert failed');
  return u.id;
}
async function alert(
  userId: string,
  kind: 'historic_low' | 'target_price',
  extra: { targetCents?: number; active?: boolean; productId?: string } = {},
) {
  const [a] = await h.db
    .insert(priceAlerts)
    .values({
      userId,
      productId: extra.productId ?? honeyId,
      kind,
      targetCents: extra.targetCents ?? null,
      active: extra.active ?? true,
    })
    .returning({ id: priceAlerts.id });
  return a?.id ?? '';
}
const notesFor = async (userId: string) =>
  (await h.db.select().from(notifications).where(eq(notifications.userId, userId))).map((n) => ({
    ...n,
    payload: n.payload as AlertPayload,
  }));

let alice: string;
let bob: string;
let carol: string;
let dave: string;

beforeAll(async () => {
  const url = testDatabaseUrl('pricing_alerts');
  await recreateDatabase(url);
  await runMigrations(url);
  await seedDatabase({ url, seed: SEED, anchorDate: ANCHOR, demoUser: false });
  h = createDb(url);
  provider = new MockPriceProvider({ seed: SEED, anchorDate: ANCHOR });
  honeyId =
    (
      await h.db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.slug, PLANT?.product ?? ''))
    )[0]?.id ?? '';
  walmartId =
    (
      await h.db
        .select({ id: stores.id })
        .from(stores)
        .where(eq(stores.slug, PLANT?.chain ?? ''))
    )[0]?.id ?? 0;
  alice = await user('alice');
  bob = await user('bob');
  carol = await user('carol');
  dave = await user('dave');
  // Dave does not shop at Walmart.
  await h.db.insert(userStores).values({
    userId: dave,
    storeId: walmartId,
    enabled: false,
    hasMembership: false,
    hasLoyalty: false,
  });
  await alert(alice, 'historic_low');
  await alert(bob, 'historic_low');
  await alert(carol, 'historic_low', { active: false });
  await alert(dave, 'historic_low');
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe('market dates', () => {
  it('starts at the seed anchor', async () => {
    expect(await marketDates(h.db)).toEqual({ anchor: ANCHOR, current: ANCHOR });
  });
});

describe('historic-low alerts on the planted clearance day', () => {
  it('nothing fires on the anchor day', async () => {
    expect((await evaluateAlerts(h.db, ANCHOR)).created).toBe(0);
  });

  it('advancing to the planted day creates exactly one notification per subscribed user', async () => {
    const day = addDays(ANCHOR, PLANT?.offsetDays ?? 1);
    const r = await advanceTo(h.db, provider, day);
    expect(r).toMatchObject({ from: ANCHOR, to: day, applied: [day] });
    const a = await notesFor(alice);
    const b = await notesFor(bob);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]?.payload).toMatchObject({
      kind: 'historic_low',
      productSlug: 'honey',
      storeName: 'Walmart',
      promoLabel: 'Clearance',
      asOf: day,
    });
    expect(a[0]?.payload.unitPriceCents).toBeLessThan(a[0]?.payload.priorLowCents ?? 0);
    expect(r.notificationsCreated).toBe(2); // alice + bob; carol is inactive, dave doesn't shop at Walmart
  });

  it('inactive alerts stay silent; a user who doesn’t shop at the store isn’t alerted by it', async () => {
    expect(await notesFor(carol)).toHaveLength(0);
    const d = await notesFor(dave);
    // Dave can only be alerted by a low at one of HIS stores, never Walmart's clearance.
    expect(d.every((n) => n.payload.storeName !== 'Walmart')).toBe(true);
  });

  it('re-running the same day, or staying on the same low price, never duplicates', async () => {
    const day = addDays(ANCHOR, PLANT?.offsetDays ?? 1);
    expect((await advanceTo(h.db, provider, day)).notificationsCreated).toBe(0);
    expect((await evaluateAlerts(h.db, day)).created).toBe(0);
    await advanceTo(h.db, provider, addDays(day, 1)); // clearance continues: same price point
    expect(await notesFor(alice)).toHaveLength(1);
    expect(await notesFor(bob)).toHaveLength(1);
    const [row] = await h.db
      .select()
      .from(priceAlerts)
      .where(and(eq(priceAlerts.userId, alice), eq(priceAlerts.kind, 'historic_low')));
    expect(row?.lastTriggeredAt).not.toBeNull();
  });
});

describe('target-price alerts compare in the product’s display unit', () => {
  it('fires at or below the target, not above', async () => {
    const { current } = await marketDates(h.db);
    const low = (await notesFor(alice))[0]?.payload.unitPriceCents ?? 0; // ¢ per oz (honey's display unit)
    const erin = await user('erin');
    const frank = await user('frank');
    await alert(erin, 'target_price', { targetCents: Math.ceil(low) });
    await alert(frank, 'target_price', { targetCents: Math.max(1, Math.floor(low) - 1) });
    await evaluateAlerts(h.db, current ?? ANCHOR);
    const e = await notesFor(erin);
    expect(e).toHaveLength(1);
    expect(e[0]?.payload).toMatchObject({
      kind: 'target_price',
      displayUnit: 'oz',
      targetCents: Math.ceil(low),
    });
    expect(await notesFor(frank)).toHaveLength(0);
  });
});
