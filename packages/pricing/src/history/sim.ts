/** Market-date simulation (SPEC Phase 5): ingest the mock provider day by day and evaluate alerts. */
import { addDays, diffDays, type IsoDate } from '@sgs/core';
import { providerSyncRuns, type Db } from '@sgs/db';
import { and, eq, sql } from 'drizzle-orm';
import { applyDay } from '../ingest/ingest.js';
import type { Metro, PriceProvider } from '../provider.js';
import { evaluateAlerts } from './alerts.js';

export interface MarketDates {
  /** End of the seeded history (first successful full sync). */
  readonly anchor: IsoDate | null;
  /** Latest market date ingested. */
  readonly current: IsoDate | null;
}

export async function marketDates(db: Db): Promise<MarketDates> {
  const [r] = await db
    .select({
      anchor: sql<
        string | null
      >`(min(${providerSyncRuns.asOf}) FILTER (WHERE ${providerSyncRuns.kind} = 'full'))::text`,
      current: sql<string | null>`max(${providerSyncRuns.asOf})::text`,
    })
    .from(providerSyncRuns)
    .where(eq(providerSyncRuns.status, 'ok'));
  return { anchor: r?.anchor ?? null, current: r?.current ?? null };
}

export interface AdvanceResult {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly applied: IsoDate[];
  readonly notificationsCreated: number;
}

/**
 * Bring the market forward to `target`, one day at a time (ingest, then evaluate alerts). Idempotent:
 * days already ingested are skipped, and alerts are always re-evaluated for the resulting date so an
 * alert created after a day was ingested still fires (notifications are de-duplicated).
 */
export async function advanceTo(
  db: Db,
  provider: PriceProvider,
  target: IsoDate,
  opts: { metro?: Metro; now?: () => Date } = {},
): Promise<AdvanceResult> {
  const metro = opts.metro ?? 'DFW';
  const now = opts.now ?? (() => new Date());
  const { current } = await marketDates(db);
  if (!current) throw new Error('No seeded market data: run pnpm db:seed first');
  const applied: IsoDate[] = [];
  let created = 0;
  for (let d = addDays(current, 1); diffDays(target, d) >= 0; d = addDays(d, 1)) {
    const [run] = await db
      .insert(providerSyncRuns)
      .values({ provider: provider.id, kind: 'daily', asOf: d, startedAt: now() })
      .returning({ id: providerSyncRuns.id });
    const s = await applyDay(db, provider, d, metro);
    await db
      .update(providerSyncRuns)
      .set({
        status: 'ok',
        finishedAt: now(),
        pricePointsWritten: s.opened + s.closedAndOpened + s.replaced,
      })
      .where(and(eq(providerSyncRuns.id, run?.id ?? -1)));
    applied.push(d);
    created += (await evaluateAlerts(db, d, { metro, now: now() })).created;
  }
  const end = applied.at(-1) ?? current;
  if (applied.length === 0)
    created += (await evaluateAlerts(db, end, { metro, now: now() })).created;
  return { from: current, to: end, applied, notificationsCreated: created };
}
