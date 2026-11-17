import type { DashboardBreakdown, DashboardSeries, DashboardSummary } from '@sgs/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Rectangle,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from 'recharts';
import { Segmented } from '../components/Segmented';
import { card, FormError, secondaryButton, Spinner } from '../components/ui';
import { ApiError } from '../lib/api';
import { formatMoney } from '../lib/format';
import {
  addDaysIso,
  chicagoToday,
  exportUrl,
  useDashboardBreakdown,
  useDashboardSeries,
  useDashboardSummary,
  type Range,
} from '../lib/trips';

const message = (e: unknown) =>
  e instanceof ApiError ? e.message : e ? 'Something went wrong' : null;

type RangeKey = '90d' | '365d' | 'all';
const RANGES: readonly { value: RangeKey; label: string }[] = [
  { value: '90d', label: '3 months' },
  { value: '365d', label: '12 months' },
  { value: 'all', label: 'All time' },
];
export function rangeFor(key: RangeKey, today: string): Range {
  const days = key === '90d' ? 90 : key === '365d' ? 365 : 3650;
  return { from: addDaysIso(today, -days), to: today };
}

const POS = 'var(--series-1)';
const NEG = 'var(--series-2)';

/** Bars coloured by sign (polarity): saved vs spent more. Text always says which, too. */
const signedBar = (key: 'valueCents' | 'savedCents') =>
  function SignedBar(props: BarShapeProps) {
    const v = (props.payload as Record<string, unknown> | undefined)?.[key];
    return <Rectangle {...props} fill={typeof v === 'number' && v < 0 ? NEG : POS} />;
  };
const seriesBar = signedBar('valueCents');
const breakdownBar = signedBar('savedCents');

/** "$12", "$1.2k" for axis ticks. */
const shortMoney = (cents: number) => {
  const d = cents / 100;
  const abs = Math.abs(d);
  const s = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${abs.toFixed(0)}`;
  return d < 0 ? `-${s}` : s;
};
const bucketLabel = (start: string, interval: 'week' | 'month', withYear = false) =>
  new Date(`${start}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    ...(interval === 'week' ? { day: 'numeric' } : {}),
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });

function Kpis({ s }: { s: DashboardSummary }) {
  const tile =
    'rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900';
  const negative = s.totalSavedCents < 0;
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Savings summary">
        <div className={tile}>
          <dt className="text-sm text-slate-600 dark:text-slate-400">
            {negative ? 'Spent more than usual' : 'Total saved'}
          </dt>
          <dd className="text-2xl font-bold tabular-nums" data-testid="kpi-saved">
            {formatMoney(Math.abs(s.totalSavedCents))}
          </dd>
        </div>
        <div className={tile}>
          <dt className="text-sm text-slate-600 dark:text-slate-400">Average saved</dt>
          <dd className="text-2xl font-bold tabular-nums" data-testid="kpi-pct">
            {s.avgSavingsPct === null ? '—' : `${s.avgSavingsPct.toFixed(1)}%`}
          </dd>
        </div>
        <div className={tile}>
          <dt className="text-sm text-slate-600 dark:text-slate-400">Trips</dt>
          <dd className="text-2xl font-bold tabular-nums" data-testid="kpi-trips">
            {s.tripCount}
          </dd>
        </div>
        <div className={tile}>
          <dt className="text-sm text-slate-600 dark:text-slate-400">Best store</dt>
          <dd className="truncate text-2xl font-bold" data-testid="kpi-best">
            {s.bestStore?.name ?? '—'}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Spent {formatMoney(s.totalSpentCents)} (including {formatMoney(s.fuelSpentCents)} fuel)
        against {formatMoney(s.baselineTotalCents)} at your usual store.
      </p>
    </div>
  );
}

function SeriesChart({ data }: { data: DashboardSeries }) {
  const savings = data.metric === 'savings';
  const hasNeg = data.points.some((p) => p.valueCents < 0);
  const rows = data.points.map((p) => ({ ...p, label: bucketLabel(p.start, data.interval) }));
  const title = `${savings ? 'Saved' : 'Spent'} per ${data.interval}`;
  const Tip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: readonly { payload?: unknown }[];
  }) => {
    const p = payload?.[0]?.payload as (typeof rows)[number] | undefined;
    if (!active || !p) return null;
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
        <p className="font-semibold">{bucketLabel(p.start, data.interval, true)}</p>
        <p className="tabular-nums">
          {savings && p.valueCents < 0
            ? `Spent ${formatMoney(-p.valueCents)} more`
            : `${savings ? 'Saved' : 'Spent'} ${formatMoney(p.valueCents)}`}
        </p>
        <p className="text-slate-600 dark:text-slate-400">
          {p.tripCount} {p.tripCount === 1 ? 'trip' : 'trips'}
        </p>
      </div>
    );
  };
  return (
    <figure className="viz-root space-y-2" aria-label={title}>
      {savings && hasNeg ? (
        <ul className="flex flex-wrap gap-3 text-sm" aria-label="Legend">
          <li className="flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-block size-3 rounded-sm"
              style={{ background: POS }}
            />
            Saved
          </li>
          <li className="flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-block size-3 rounded-sm"
              style={{ background: NEG }}
            />
            Spent more than usual
          </li>
        </ul>
      ) : null}
      <div
        className="h-56 w-full"
        role="img"
        aria-label={`${title}. The table below has the same numbers.`}
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 320, height: 224 }}
        >
          <BarChart
            data={rows}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            barCategoryGap={2}
          >
            <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--viz-muted)', fontSize: 12 }}
              stroke="var(--viz-grid)"
              interval="preserveStartEnd"
              minTickGap={12}
            />
            <YAxis
              tickFormatter={shortMoney}
              tick={{ fill: 'var(--viz-muted)', fontSize: 12 }}
              stroke="var(--viz-grid)"
              width={52}
            />
            <Tooltip content={Tip} cursor={{ fill: 'var(--viz-grid)', opacity: 0.5 }} />
            {hasNeg ? <ReferenceLine y={0} stroke="var(--viz-muted)" /> : null}
            <Bar
              dataKey="valueCents"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
              shape={seriesBar}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium">Show data table</summary>
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="text-left">
              <th scope="col">{data.interval === 'week' ? 'Week of' : 'Month'}</th>
              <th scope="col" className="text-right">
                {savings ? 'Saved' : 'Spent'}
              </th>
              <th scope="col" className="text-right">
                Trips
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.start}>
                <th scope="row" className="font-normal">
                  {bucketLabel(p.start, data.interval, true)}
                </th>
                <td className="text-right tabular-nums">{formatMoney(p.valueCents)}</td>
                <td className="text-right tabular-nums">{p.tripCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Top rows by savings; the rest fold into "Other" (never a 9th hue — it's one series anyway). */
export function foldRows(rows: DashboardBreakdown['rows'], max = 8): DashboardBreakdown['rows'] {
  if (rows.length <= max) return rows;
  const head = rows.slice(0, max - 1);
  const tail = rows.slice(max - 1);
  return [
    ...head,
    {
      key: -1,
      label: 'Other',
      spentCents: tail.reduce((a, r) => a + r.spentCents, 0),
      savedCents: tail.reduce((a, r) => a + r.savedCents, 0),
      itemCount: tail.reduce((a, r) => a + r.itemCount, 0),
    },
  ];
}

function BreakdownChart({ data }: { data: DashboardBreakdown }) {
  const rows = foldRows(data.rows);
  const title = `Saved by ${data.by} (items, before fuel)`;
  return (
    <figure className="viz-root space-y-2" aria-label={title}>
      <div
        className="w-full"
        style={{ height: rows.length * 40 + 16 }}
        role="img"
        aria-label={`${title}. The table below has the same numbers.`}
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 320, height: 200 }}
        >
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 0, right: 64, bottom: 0, left: 0 }}
            barCategoryGap={8}
          >
            <XAxis type="number" hide domain={[(min: number) => Math.min(0, min), 'auto']} />
            <YAxis
              type="category"
              dataKey="label"
              width={104}
              tick={{ fill: 'var(--viz-text)', fontSize: 13 }}
              stroke="var(--viz-grid)"
              tickLine={false}
            />
            <ReferenceLine x={0} stroke="var(--viz-grid)" />
            <Bar
              dataKey="savedCents"
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
              shape={breakdownBar}
            >
              <LabelList
                dataKey="savedCents"
                position="right"
                formatter={(v: unknown) => (typeof v === 'number' ? formatMoney(v) : '')}
                style={{ fill: 'var(--viz-text)', fontSize: 12 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium">Show data table</summary>
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="text-left">
              <th scope="col">{data.by === 'store' ? 'Store' : 'Category'}</th>
              <th scope="col" className="text-right">
                Spent
              </th>
              <th scope="col" className="text-right">
                Saved
              </th>
              <th scope="col" className="text-right">
                Items
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="font-normal">
                  {r.label}
                </th>
                <td className="text-right tabular-nums">{formatMoney(r.spentCents)}</td>
                <td className="text-right tabular-nums">{formatMoney(r.savedCents)}</td>
                <td className="text-right tabular-nums">{r.itemCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** S9: savings dashboard. */
export function DashboardPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('365d');
  const [metric, setMetric] = useState<'savings' | 'spend'>('savings');
  const [interval, setInterval] = useState<'week' | 'month'>('month');
  const [by, setBy] = useState<'store' | 'category'>('store');
  const range = rangeFor(rangeKey, chicagoToday());
  const summary = useDashboardSummary(range);
  const series = useDashboardSeries(range, metric, interval);
  const breakdown = useDashboardBreakdown(range, by);

  return (
    <section aria-labelledby="dash-h" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 id="dash-h" className="text-2xl font-bold tracking-tight">
          Savings
        </h1>
        <Segmented legend="Time range" options={RANGES} value={rangeKey} onChange={setRangeKey} />
      </div>
      {summary.isPending ? (
        <Spinner label="Loading savings…" />
      ) : summary.isError ? (
        <FormError message={message(summary.error)} />
      ) : summary.data.tripCount === 0 ? (
        <div className={`${card} space-y-2`}>
          <p className="font-semibold">No trips in this period yet.</p>
          <p className="text-slate-700 dark:text-slate-300">
            Compare a list, then tap <strong>Save trip</strong> under “I shopped this” to start
            tracking what you save.
          </p>
          <Link to="/compare" className={`${secondaryButton} w-fit`}>
            Compare a list
          </Link>
        </div>
      ) : (
        <>
          <Kpis s={summary.data} />
          <section aria-labelledby="time-h" className={`${card} space-y-3`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="time-h" className="text-lg font-semibold">
                Over time
              </h2>
              <div className="flex flex-wrap gap-2">
                <Segmented
                  legend="Measure"
                  options={[
                    { value: 'savings', label: 'Saved' },
                    { value: 'spend', label: 'Spent' },
                  ]}
                  value={metric}
                  onChange={setMetric}
                />
                <Segmented
                  legend="Interval"
                  options={[
                    { value: 'month', label: 'Monthly' },
                    { value: 'week', label: 'Weekly' },
                  ]}
                  value={interval}
                  onChange={setInterval}
                />
              </div>
            </div>
            {series.isPending ? (
              <Spinner label="Loading chart…" />
            ) : series.isError ? (
              <FormError message={message(series.error)} />
            ) : (
              <SeriesChart data={series.data} />
            )}
          </section>
          <section aria-labelledby="where-h" className={`${card} space-y-3`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="where-h" className="text-lg font-semibold">
                Where you saved
              </h2>
              <Segmented
                legend="Group by"
                options={[
                  { value: 'store', label: 'By store' },
                  { value: 'category', label: 'By category' },
                ]}
                value={by}
                onChange={setBy}
              />
            </div>
            {breakdown.isPending ? (
              <Spinner label="Loading breakdown…" />
            ) : breakdown.isError ? (
              <FormError message={message(breakdown.error)} />
            ) : (
              <BreakdownChart data={breakdown.data} />
            )}
          </section>
        </>
      )}
      <section aria-labelledby="export-h" className={`${card} space-y-3`}>
        <h2 id="export-h" className="text-lg font-semibold">
          Export & history
        </h2>
        <div className="flex flex-wrap gap-2">
          <a href={exportUrl('csv', range)} download className={secondaryButton}>
            Download CSV
          </a>
          <a href={exportUrl('pdf', range)} download className={secondaryButton}>
            Download PDF
          </a>
          <Link to="/trips" className={secondaryButton}>
            Trip history
          </Link>
        </div>
      </section>
    </section>
  );
}
