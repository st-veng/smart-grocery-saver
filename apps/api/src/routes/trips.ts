import { todayIn } from '@sgs/core';
import {
  CommitTripRequest,
  DashboardBreakdownQuery,
  DashboardRangeQuery,
  DashboardSeriesQuery,
  OptimizeRequest,
  type OptimizeResponse,
  type DashboardBreakdown,
  type DashboardSeries,
  type DashboardSummary,
  type TripDetail,
} from '@sgs/shared';
import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { auth, requireAuth } from '../auth/middleware.js';
import { breakdown, resolveRange, series, summary } from '../services/dashboard.js';
import { savingsCsv, savingsPdf } from '../services/exports.js';
import { optimizeListForUser } from '../services/optimize.js';
import { commitTrip, deleteTrip, getTrip, listTrips } from '../services/trips.js';
import { idParam, Paging, parse } from '../validate.js';

/** Trips, dashboard and exports (SPEC §5 "Trips, dashboard & export"). */
export function tripsRouter(deps: AppDeps): Router {
  const r = Router();
  const { db } = deps;
  const guard = requireAuth(db, deps.tokens);
  r.use(['/trips', '/dashboard', '/exports'], guard);
  const today = () => todayIn('America/Chicago', deps.clock());

  r.post('/trips', async (req, res) => {
    const input = parse(CommitTripRequest, req.body);
    const trip: TripDetail = await commitTrip(db, auth(res).userId, input, {
      today: today(),
      radiusMiles: deps.config.preselectRadiusMiles,
      metro: deps.metro,
      defaultOrigin: deps.config.defaultOrigin,
      fuelCentsPerGalDefault: deps.config.fuelCentsPerGalDefault ?? 279,
    });
    res.status(201).json({ trip });
  });
  /** POST because it takes a body of options; it changes nothing. */
  r.post('/lists/:id/optimize', guard, async (req, res) => {
    const input = parse(OptimizeRequest, req.body ?? {});
    const body: OptimizeResponse = await optimizeListForUser(
      db,
      auth(res).userId,
      idParam(req, 'id'),
      input,
      {
        asOf: today(),
        radiusMiles: deps.config.preselectRadiusMiles,
        metro: deps.metro,
        defaultOrigin: deps.config.defaultOrigin,
        fuelCentsPerGalDefault: deps.config.fuelCentsPerGalDefault ?? 279,
      },
    );
    res.json(body);
  });
  r.get('/trips', async (req, res) => {
    const q = parse(Paging, req.query);
    res.json(await listTrips(db, auth(res).userId, q));
  });
  r.get('/trips/:id', async (req, res) => {
    res.json({ trip: await getTrip(db, auth(res).userId, idParam(req, 'id')) });
  });
  r.delete('/trips/:id', async (req, res) => {
    await deleteTrip(db, auth(res).userId, idParam(req, 'id'));
    res.status(204).end();
  });

  r.get('/dashboard/summary', async (req, res) => {
    const range = resolveRange(parse(DashboardRangeQuery, req.query), today());
    const body: DashboardSummary = await summary(db, auth(res).userId, range);
    res.json(body);
  });
  r.get('/dashboard/series', async (req, res) => {
    const q = parse(DashboardSeriesQuery, req.query);
    const body: DashboardSeries = await series(
      db,
      auth(res).userId,
      resolveRange(q, today()),
      q.metric,
      q.interval,
    );
    res.json(body);
  });
  r.get('/dashboard/breakdown', async (req, res) => {
    const q = parse(DashboardBreakdownQuery, req.query);
    const body: DashboardBreakdown = await breakdown(
      db,
      auth(res).userId,
      resolveRange(q, today()),
      q.by,
    );
    res.json(body);
  });

  r.get('/exports/savings.csv', async (req, res) => {
    const range = resolveRange(parse(DashboardRangeQuery, req.query), today());
    const csv = await savingsCsv(db, auth(res).userId, range);
    res
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="savings-${range.from}-to-${range.to}.csv"`,
        'Cache-Control': 'no-store',
      })
      .send(csv);
  });
  r.get('/exports/savings.pdf', async (req, res) => {
    const range = resolveRange(parse(DashboardRangeQuery, req.query), today());
    const pdf = await savingsPdf(db, auth(res).userId, range, {
      generatedAt: deps.clock(),
      demoPrices: deps.config.demoPrices ?? true,
    });
    res
      .status(200)
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="savings-${range.from}-to-${range.to}.pdf"`,
        'Cache-Control': 'no-store',
      })
      .send(pdf);
  });
  return r;
}
