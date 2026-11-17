/** Single- vs multi-store optimizer for a list (SPEC §5 Optimizer, Phase 7). */
import { optimize, type IsoDate, type OptimizedPlan as CorePlan } from '@sgs/core';
import type { Db } from '@sgs/db';
import type {
  OptimizedPlan,
  OptimizeRequest as OptimizeRequestSchema,
  OptimizeResponse,
} from '@sgs/shared';
import type { z } from 'zod';
import { computeComparison } from './compare.js';
import { tripSettings, type TripOpts } from './trips.js';

type Input = z.output<typeof OptimizeRequestSchema>;

export async function optimizeListForUser(
  db: Db,
  userId: string,
  listId: string,
  input: Input,
  opts: Omit<TripOpts, 'today'> & { readonly asOf: IsoDate },
): Promise<OptimizeResponse> {
  const { list, items, prods, storeRows, result } = await computeComparison(db, userId, listId, {
    asOf: opts.asOf,
    radiusMiles: opts.radiusMiles,
    metro: opts.metro,
  });
  const saved = await tripSettings(db, userId, opts);
  const settings = {
    home: input.origin ?? saved.home,
    mpg: input.mpg ?? saved.mpg,
    fuelCentsPerGal: input.fuelCentsPerGal ?? saved.fuelCentsPerGal,
  };
  const r = optimize(result, {
    maxStores: input.maxStores,
    home: settings.home,
    locations: saved.locations,
    mpg: settings.mpg,
    fuelCentsPerGal: settings.fuelCentsPerGal,
    timeValueCentsPerHour: input.timeValueCentsPerHour,
    minutesPerStop: input.minutesPerStop,
  });

  const itemById = new Map(items.map((i) => [i.id, i]));
  const lineAt = new Map(
    result.lines.map((l) => [l.itemId, new Map(l.stores.map((s) => [s.storeId, s]))]),
  );
  const storeName = (id: number) =>
    storeRows.find((s) => s.id === id)?.name ?? `Store ${String(id)}`;
  const toPlan = (p: CorePlan): OptimizedPlan => ({
    storeIds: p.storeIds,
    route: p.route,
    assignments: p.assignments.map((a) => {
      const li = itemById.get(a.itemId);
      const prod = li?.productId ? prods.get(li.productId) : undefined;
      const s = lineAt.get(a.itemId)?.get(a.storeId);
      return {
        itemId: a.itemId,
        rawText: li?.rawText ?? '',
        productName: prod?.name ?? li?.rawText ?? '',
        storeId: a.storeId,
        title: s?.title ?? '',
        packages: s?.packages ?? null,
        lineCents: a.lineCents,
        baselineLineCents: a.baselineLineCents,
      };
    }),
    missing: p.missing.map((itemId) => ({ itemId, rawText: itemById.get(itemId)?.rawText ?? '' })),
    complete: p.complete,
    itemsCents: p.itemsCents,
    distanceMiles: p.distanceMiles,
    fuelCents: p.fuelCents,
    timeCents: p.timeCents,
    totalCents: p.totalCents,
    baselineCents: p.baselineCents,
    savingsVsBaselineCents: p.savingsVsBaselineCents,
  });

  const baselineId = result.baseline.storeId;
  return {
    listId: list.id,
    listName: list.name,
    asOf: opts.asOf,
    maxStores: input.maxStores,
    stores: storeRows.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      brandColor: s.brandColor,
      requiresMembership: s.requiresMembership,
      loyaltyProgram: s.loyaltyProgram,
    })),
    baselineStore: baselineId === null ? null : { id: baselineId, name: storeName(baselineId) },
    settings: {
      mpg: settings.mpg,
      fuelCentsPerGal: settings.fuelCentsPerGal,
      timeValueCentsPerHour: input.timeValueCentsPerHour,
      minutesPerStop: input.minutesPerStop,
      matchesTrip:
        input.origin === undefined &&
        input.mpg === undefined &&
        input.fuelCentsPerGal === undefined,
    },
    single: toPlan(r.single),
    multi: r.multi.map(toPlan),
    recommendation: r.recommendation,
    unpriced: result.lines
      .filter((l) => l.unpriced)
      .map((l) => itemById.get(l.itemId)?.rawText ?? ''),
    subsetsEvaluated: r.subsetsEvaluated,
  };
}
