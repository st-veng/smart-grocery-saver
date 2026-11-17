/** Ingestion pipeline (SPEC §2.4): provider → normalize → match → upsert store_items → price periods. */
import { addDays, type IsoDate } from '@sgs/core';
import {
  pricePoints,
  providerSyncRuns,
  storeItems,
  storeLocations,
  stores,
  type Db,
} from '@sgs/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Metro, PriceProvider, ProviderPrice } from '../provider.js';
import { Matcher } from './match.js';
import { finalSize, normalizeItem } from './normalize.js';
import { applyObservation, observationsToPeriods, rangeLiteral, type Period } from './periods.js';

export interface SyncSummary {
  readonly stores: number;
  readonly locations: number;
  readonly itemsUpserted: number;
  readonly matched: number;
  readonly unmatched: number;
  readonly unparseable: number;
  readonly pricePointsWritten: number;
}

const CHUNK = 1000;
function chunks<T>(xs: readonly T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export async function syncStores(
  db: Db,
  provider: PriceProvider,
  metro: Metro,
): Promise<{ ids: Map<string, number>; locations: number }> {
  const ids = new Map<string, number>();
  let locations = 0;
  for (const s of await provider.listStores(metro)) {
    const [row] = await db
      .insert(stores)
      .values({ ...s })
      .onConflictDoUpdate({
        target: stores.slug,
        set: {
          name: s.name,
          brandColor: s.brandColor,
          requiresMembership: s.requiresMembership,
          membershipFeeCents: s.membershipFeeCents,
          loyaltyProgram: s.loyaltyProgram,
          sortOrder: s.sortOrder,
        },
      })
      .returning({ id: stores.id });
    if (!row) throw new Error(`store upsert failed: ${s.slug}`);
    ids.set(s.slug, row.id);
    const locs = await provider.listLocations(s.slug, metro);
    for (const l of locs) {
      await db
        .insert(storeLocations)
        .values({ storeId: row.id, metro, ...l })
        .onConflictDoUpdate({
          target: [storeLocations.storeId, storeLocations.externalRef],
          set: {
            name: l.name,
            address: l.address,
            city: l.city,
            zip: l.zip,
            lat: l.lat,
            lng: l.lng,
            metro,
          },
        });
      locations++;
    }
  }
  return { ids, locations };
}

export interface UpsertedItem {
  readonly id: string;
  readonly sku: string;
}

/** Fetch, normalize, match and upsert every item of one store. Manual matches are never overwritten. */
export async function syncItems(
  db: Db,
  provider: PriceProvider,
  storeSlug: string,
  storeId: number,
  matcher: Matcher,
): Promise<{ items: UpsertedItem[]; matched: number; unmatched: number; unparseable: number }> {
  const items: UpsertedItem[] = [];
  let matched = 0;
  let unmatched = 0;
  let unparseable = 0;
  let cursor: string | null = null;
  do {
    const page = await provider.listItems(storeSlug, cursor);
    const rows: (typeof storeItems.$inferInsert)[] = [];
    for (const item of page.items) {
      const n = normalizeItem(item);
      if (!n.roughSize) {
        unparseable++; // review queue: size could not be determined — never guessed
        continue;
      }
      const m = await matcher.match(n);
      const size = finalSize(item, m?.product.dimension ?? null) ?? n.roughSize;
      if (m) {
        matched++;
        matcher.learnUpc(item.upc, m.product.id);
      } else unmatched++;
      rows.push({
        storeId,
        productId: m?.product.id ?? null,
        sku: item.sku,
        upc: item.upc,
        title: item.title,
        brand: item.brand,
        isStoreBrand: item.isStoreBrand,
        packCount: size.packCount,
        unitQuantity: size.unitQuantity,
        unit: size.unit,
        pricingBasis: size.perWeight ? 'per_weight' : 'per_package',
        matchMethod: m?.method ?? null,
        matchConfidence: m?.confidence ?? null,
      });
    }
    for (const part of chunks(rows, 500)) {
      const keepManual = (col: string) =>
        sql.raw(
          `CASE WHEN store_items.match_method = 'manual' THEN store_items.${col} ELSE excluded.${col} END`,
        );
      const inserted = await db
        .insert(storeItems)
        .values(part)
        .onConflictDoUpdate({
          target: [storeItems.storeId, storeItems.sku],
          set: {
            upc: sql`excluded.upc`,
            title: sql`excluded.title`,
            brand: sql`excluded.brand`,
            isStoreBrand: sql`excluded.is_store_brand`,
            packCount: sql`excluded.pack_count`,
            unitQuantity: sql`excluded.unit_quantity`,
            unit: sql`excluded.unit`,
            pricingBasis: sql`excluded.pricing_basis`,
            productId: keepManual('product_id'),
            matchMethod: keepManual('match_method'),
            matchConfidence: keepManual('match_confidence'),
            active: true,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: storeItems.id, sku: storeItems.sku });
      items.push(...inserted);
    }
    cursor = page.nextCursor;
  } while (cursor !== null);
  return { items, matched, unmatched, unparseable };
}

function periodRow(
  storeItemId: string,
  metro: Metro,
  source: string,
  p: Period,
): typeof pricePoints.$inferInsert {
  return {
    storeItemId,
    metro,
    validDuring: rangeLiteral(p),
    regularPriceCents: p.regularPriceCents,
    salePriceCents: p.salePriceCents,
    promoType: p.promoType,
    promoLabel: p.promoLabel,
    minQty: p.minQty,
    memberOnly: p.memberOnly,
    source,
    observedAt: new Date(`${p.from}T12:00:00Z`),
  };
}

/** Replace all price periods of the given items with history [from, to], the last period left open. */
export async function loadHistory(
  db: Db,
  provider: PriceProvider,
  storeSlug: string,
  items: readonly UpsertedItem[],
  range: { from: IsoDate; to: IsoDate },
  metro: Metro,
): Promise<number> {
  if (!provider.getPriceHistory) throw new Error(`provider ${provider.id} has no history endpoint`);
  let written = 0;
  for (const part of chunks(items, 200)) {
    await db.delete(pricePoints).where(
      inArray(
        pricePoints.storeItemId,
        part.map((i) => i.id),
      ),
    );
    const rows: (typeof pricePoints.$inferInsert)[] = [];
    for (const it of part) {
      const obs = await provider.getPriceHistory({
        store: storeSlug,
        sku: it.sku,
        from: range.from,
        to: range.to,
      });
      for (const p of observationsToPeriods(obs, true))
        rows.push(periodRow(it.id, metro, provider.id, p));
    }
    for (const c of chunks(rows)) await db.insert(pricePoints).values(c);
    written += rows.length;
  }
  return written;
}

export interface ApplyDaySummary {
  readonly unchanged: number;
  readonly opened: number;
  readonly closedAndOpened: number;
  readonly replaced: number;
  readonly stale: number;
}

/** Ingest one day of observations for every store (daily sync / sim:advance). */
export async function applyDay(
  db: Db,
  provider: PriceProvider,
  asOf: IsoDate,
  metro: Metro,
): Promise<ApplyDaySummary> {
  const summary = { unchanged: 0, opened: 0, closedAndOpened: 0, replaced: 0, stale: 0 };
  const storeRows = await db.select({ id: stores.id, slug: stores.slug }).from(stores);
  for (const store of storeRows) {
    const obs = await provider.getPrices({ store: store.slug, metro, asOf });
    const bySku = new Map<string, ProviderPrice>(obs.map((o) => [o.sku, o]));
    const current = await db.execute<{
      item_id: string;
      sku: string;
      pp_id: number | null;
      lower: string | null;
      regular_price_cents: number;
      sale_price_cents: number | null;
      promo_type: ProviderPrice['promoType'];
      promo_label: string | null;
      min_qty: number;
      member_only: boolean;
    }>(sql`
      SELECT si.id AS item_id, si.sku, pp.id AS pp_id, lower(pp.valid_during)::text AS lower,
             pp.regular_price_cents, pp.sale_price_cents, pp.promo_type, pp.promo_label, pp.min_qty, pp.member_only
      FROM store_items si
      LEFT JOIN price_points pp ON pp.store_item_id = si.id AND upper_inf(pp.valid_during)
        AND pp.metro = ${metro} AND pp.store_location_id IS NULL
      WHERE si.store_id = ${store.id} AND si.active`);
    await db.transaction(async (tx) => {
      for (const row of current.rows) {
        const o = bySku.get(row.sku);
        if (!o) continue;
        const open: Period | null =
          row.pp_id !== null && row.lower !== null
            ? {
                from: row.lower,
                to: null,
                regularPriceCents: row.regular_price_cents,
                salePriceCents: row.sale_price_cents,
                promoType: row.promo_type,
                promoLabel: row.promo_label,
                minQty: row.min_qty,
                memberOnly: row.member_only,
              }
            : null;
        const action = applyObservation(open, o);
        switch (action.kind) {
          case 'unchanged':
            summary.unchanged++;
            break;
          case 'stale':
            summary.stale++;
            break;
          case 'open':
            await tx
              .insert(pricePoints)
              .values(periodRow(row.item_id, metro, provider.id, action.period));
            summary.opened++;
            break;
          case 'replace':
            await tx.delete(pricePoints).where(eq(pricePoints.id, row.pp_id ?? -1));
            await tx
              .insert(pricePoints)
              .values(periodRow(row.item_id, metro, provider.id, action.period));
            summary.replaced++;
            break;
          case 'close-and-open':
            await tx
              .update(pricePoints)
              .set({
                validDuring: sql`daterange(lower(${pricePoints.validDuring}), ${action.closeAt}::date)`,
              })
              .where(and(eq(pricePoints.id, row.pp_id ?? -1)));
            await tx
              .insert(pricePoints)
              .values(periodRow(row.item_id, metro, provider.id, action.period));
            summary.closedAndOpened++;
            break;
        }
      }
    });
  }
  return summary;
}

/** Full sync used by the seed: stores, locations, items, and `days` of history ending at `anchor`. */
export async function fullSync(
  db: Db,
  provider: PriceProvider,
  opts: { metro: Metro; anchor: IsoDate; days: number; log?: (msg: string) => void },
): Promise<SyncSummary> {
  const [run] = await db
    .insert(providerSyncRuns)
    .values({ provider: provider.id, kind: 'full', asOf: opts.anchor })
    .returning({ id: providerSyncRuns.id });
  const runId = run?.id ?? -1;
  try {
    const { ids, locations } = await syncStores(db, provider, opts.metro);
    const matcher = await Matcher.create(db);
    let itemsUpserted = 0;
    let matched = 0;
    let unmatched = 0;
    let unparseable = 0;
    let pricePointsWritten = 0;
    const from = addDays(opts.anchor, -(opts.days - 1));
    for (const [slug, storeId] of ids) {
      const r = await syncItems(db, provider, slug, storeId, matcher);
      itemsUpserted += r.items.length;
      matched += r.matched;
      unmatched += r.unmatched;
      unparseable += r.unparseable;
      const written = await loadHistory(
        db,
        provider,
        slug,
        r.items,
        { from, to: opts.anchor },
        opts.metro,
      );
      pricePointsWritten += written;
      opts.log?.(
        `  ${slug.padEnd(10)} ${String(r.items.length).padStart(4)} items, ${written} price periods`,
      );
    }
    await db
      .update(providerSyncRuns)
      .set({
        status: 'ok',
        finishedAt: new Date(),
        itemsUpserted,
        pricePointsWritten,
        unmatchedItems: unmatched + unparseable,
      })
      .where(eq(providerSyncRuns.id, runId));
    return {
      stores: ids.size,
      locations,
      itemsUpserted,
      matched,
      unmatched,
      unparseable,
      pricePointsWritten,
    };
  } catch (err) {
    await db
      .update(providerSyncRuns)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      })
      .where(eq(providerSyncRuns.id, runId));
    throw err;
  }
}
