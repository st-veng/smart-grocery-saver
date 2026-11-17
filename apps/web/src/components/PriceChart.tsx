import type { HistoryResponse } from '@sgs/shared';
import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatUnitPrice } from '../lib/format';

/** Validated categorical slots (styles.css .viz-root). Max 4 lines at once: beyond that, pick. */
export const MAX_SERIES = 4;
const SLOT_VARS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
] as const;
const DAY_MS = 86_400_000;
const ts = (d: string) => Date.parse(`${d}T00:00:00Z`);
const shortName = (n: string) => (n.length > 11 ? (n.split(' ')[0] ?? n) : n);
const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Value of a step series on day t (last point at or before t). */
function valueAt(points: HistoryResponse['series'][number]['points'], t: number): number | null {
  let v: number | null = null;
  for (const p of points) {
    if (ts(p.date) <= t) v = p.unitPriceCents;
    else break;
  }
  return v;
}

/** Default selection: the cheapest stores today, plus the usual store; colours assigned in that order. */
export function defaultSelection(h: HistoryResponse, baselineStoreId: number | null): number[] {
  const end = ts(h.to);
  const ranked = h.series
    .map((s) => ({ id: s.storeId, v: valueAt(s.points, end) }))
    .filter((x) => x.v !== null)
    .sort((a, b) => (a.v ?? 0) - (b.v ?? 0) || a.id - b.id)
    .map((x) => x.id);
  const pick = ranked.slice(0, MAX_SERIES - 1);
  if (
    baselineStoreId !== null &&
    h.series.some((s) => s.storeId === baselineStoreId) &&
    !pick.includes(baselineStoreId)
  ) {
    pick.push(baselineStoreId);
  }
  for (const id of ranked)
    if (pick.length < Math.min(MAX_SERIES, ranked.length) && !pick.includes(id)) pick.push(id);
  return pick;
}

interface Props {
  readonly data: HistoryResponse;
  readonly baselineStoreId: number | null;
}

export function PriceChart({ data, baselineStoreId }: Props) {
  // storeId → slot. Survivors keep their slot when others are toggled (colour follows the store).
  const [slots, setSlots] = useState<Map<number, number>>(
    () => new Map(defaultSelection(data, baselineStoreId).map((id, i) => [id, i])),
  );
  const unit = data.product.displayUnit;
  const name = (id: number) => data.stores.find((s) => s.id === id)?.name ?? '?';
  const visible = data.series.filter((s) => slots.has(s.storeId));
  const from = ts(data.from);
  const to = ts(data.to);

  // Rows at every change date of a visible series, plus the range end, so steps reach the right edge.
  const times = [
    ...new Set([from, to, ...visible.flatMap((s) => s.points.map((p) => ts(p.date)))]),
  ].sort((a, b) => a - b);
  const rows = times.map((t) => {
    const row: Record<string, number | null> = { t };
    for (const s of visible) row[`s${String(s.storeId)}`] = valueAt(s.points, t);
    return row;
  });
  const values = rows
    .flatMap((r) => visible.map((s) => r[`s${String(s.storeId)}`]))
    .filter((v): v is number => typeof v === 'number');
  const low = data.historicLow?.unitPriceCents ?? null;
  const all = low !== null ? [...values, low] : values;
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  const pad = Math.max((hi - lo) * 0.12, hi * 0.02, 0.01);
  const domain: [number, number] = [Math.max(0, lo - pad), hi + pad];

  // End labels: lay out top-down by last value, ≥ 14px apart, before render. Order-independent and
  // idempotent (Recharts may call a label renderer more than once per render). The plot is h-64
  // (256px) minus the margins and the x-axis band.
  const pxPerCent = (256 - 8 - 4 - 30) / (domain[1] - domain[0]);
  const last = rows.at(-1);
  const ends = visible
    .map((s) => ({ id: s.storeId, v: last?.[`s${String(s.storeId)}`] ?? null }))
    .filter((e): e is { id: number; v: number } => typeof e.v === 'number')
    .sort((a, b) => b.v - a.v);
  const labelShift = new Map<number, number>();
  let prevY = -Infinity;
  for (const e of ends) {
    const raw = (domain[1] - e.v) * pxPerCent;
    const y = Math.max(raw, prevY + 14);
    labelShift.set(e.id, y - raw);
    prevY = y;
  }
  const endLabel =
    (storeId: number) => (props: { x?: number | string; y?: number | string; index?: number }) => {
      if (
        props.index !== rows.length - 1 ||
        typeof props.x !== 'number' ||
        typeof props.y !== 'number'
      )
        return null;
      const y = props.y + (labelShift.get(storeId) ?? 0);
      return (
        <text x={props.x + 6} y={y} dy={4} fontSize={12} fill="var(--viz-muted)">
          {shortName(name(storeId))}
        </text>
      );
    };

  const toggle = (id: number) => {
    setSlots((cur) => {
      const next = new Map(cur);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
        return next;
      }
      if (next.size >= MAX_SERIES) return cur;
      const used = new Set(next.values());
      const free = [0, 1, 2, 3].find((s) => !used.has(s)) ?? 0;
      next.set(id, free);
      return next;
    });
  };

  const TooltipBody = ({ active, label }: { active?: boolean; label?: unknown }) => {
    if (!active || typeof label !== 'number') return null;
    const day = Math.floor(label / DAY_MS) * DAY_MS;
    const items = visible
      .map((s) => ({ id: s.storeId, v: valueAt(s.points, day) }))
      .sort((a, b) => (a.v ?? Infinity) - (b.v ?? Infinity));
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-1 font-semibold">{fmtDate(day)}</p>
        {items.map((it) => (
          <p key={it.id} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-full"
              style={{ background: SLOT_VARS[slots.get(it.id) ?? 0] }}
            />
            <span className="flex-1">{name(it.id)}</span>
            <span className="tabular-nums">
              {it.v === null ? '—' : formatUnitPrice(it.v, unit)}
            </span>
          </p>
        ))}
      </div>
    );
  };

  return (
    <figure
      className="viz-root space-y-3"
      data-visible-series={visible.length}
      aria-label={`${data.product.name} unit price history by store`}
    >
      <fieldset>
        <legend className="mb-1 text-sm font-semibold">Stores in chart (up to {MAX_SERIES})</legend>
        <ul className="flex flex-wrap gap-2" aria-label="Stores in chart">
          {data.series.map((s) => {
            const on = slots.has(s.storeId);
            const slot = slots.get(s.storeId);
            return (
              <li key={s.storeId}>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-slate-300 px-3 text-sm has-[:checked]:border-slate-500 dark:border-slate-700 dark:has-[:checked]:border-slate-400">
                  <input
                    type="checkbox"
                    className="size-4 accent-slate-700"
                    checked={on}
                    disabled={(!on && slots.size >= MAX_SERIES) || (on && slots.size === 1)}
                    onChange={() => {
                      toggle(s.storeId);
                    }}
                  />
                  <span
                    aria-hidden="true"
                    className="inline-block h-0.5 w-4 rounded-full"
                    style={{
                      background: on && slot !== undefined ? SLOT_VARS[slot] : 'transparent',
                      outline: on ? 'none' : '1px dashed var(--viz-muted)',
                    }}
                  />
                  {name(s.storeId)}
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div
        className="h-64 w-full"
        role="img"
        aria-label={`Line chart of the lowest unit price per store from ${fmtDate(from)} to ${fmtDate(to)}. The data table below has the same information.`}
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 320, height: 256 }}
        >
          <LineChart data={rows} margin={{ top: 8, right: 76, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[from, to]}
              tickFormatter={fmtDate}
              tickCount={4}
              tick={{ fill: 'var(--viz-muted)', fontSize: 12 }}
              stroke="var(--viz-grid)"
            />
            <YAxis
              domain={domain}
              tickFormatter={(v: number) => formatUnitPrice(v, unit)}
              tickCount={4}
              width={72}
              tick={{ fill: 'var(--viz-muted)', fontSize: 12 }}
              stroke="var(--viz-grid)"
            />
            <Tooltip
              content={TooltipBody}
              cursor={{ stroke: 'var(--viz-muted)', strokeWidth: 1 }}
            />
            {low !== null ? (
              <ReferenceLine
                y={low}
                stroke="var(--viz-muted)"
                strokeDasharray="4 4"
                label={{
                  value: '1-yr low',
                  position: 'insideBottomLeft',
                  fill: 'var(--viz-muted)',
                  fontSize: 12,
                }}
              />
            ) : null}
            {visible.map((s) => (
              <Line
                key={s.storeId}
                dataKey={`s${String(s.storeId)}`}
                name={name(s.storeId)}
                type="stepAfter"
                stroke={SLOT_VARS[slots.get(s.storeId) ?? 0]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: 'var(--viz-surface)', strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
                label={endLabel(s.storeId)}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
          Show data table
        </summary>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Unit price by store, {fmtDate(from)} – {fmtDate(to)}
          </caption>
          <thead>
            <tr className="text-slate-600 dark:text-slate-400">
              <th scope="col" className="py-1 font-medium">
                Store
              </th>
              <th scope="col" className="py-1 font-medium">
                Today
              </th>
              <th scope="col" className="py-1 font-medium">
                Low
              </th>
              <th scope="col" className="py-1 font-medium">
                High
              </th>
            </tr>
          </thead>
          <tbody>
            {data.series.map((s) => {
              const vs = s.points
                .map((p) => p.unitPriceCents)
                .filter((v): v is number => v !== null);
              const today = valueAt(s.points, to);
              return (
                <tr key={s.storeId} className="border-t border-slate-100 dark:border-slate-800">
                  <th scope="row" className="py-1 font-medium">
                    {name(s.storeId)}
                  </th>
                  <td className="py-1 tabular-nums">
                    {today === null ? '—' : formatUnitPrice(today, unit)}
                  </td>
                  <td className="py-1 tabular-nums">
                    {vs.length ? formatUnitPrice(Math.min(...vs), unit) : '—'}
                  </td>
                  <td className="py-1 tabular-nums">
                    {vs.length ? formatUnitPrice(Math.max(...vs), unit) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
