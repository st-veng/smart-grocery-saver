import type { CompareLineResult, ComparisonResponse, LineAtStore, StoreTotal } from '@sgs/shared';
import { useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { card, FormError, primaryButton, Spinner } from '../components/ui';
import { ApiError } from '../lib/api';
import {
  formatMoney,
  formatNumber,
  formatPct,
  formatQuantity,
  formatUnitPrice,
  UNIT_LABEL,
} from '../lib/format';
import { useComparison, useLists } from '../lib/lists';
import { addDaysIso, chicagoToday, useCommitTrip } from '../lib/trips';

const message = (e: unknown) =>
  e instanceof ApiError ? e.message : e ? 'Something went wrong' : null;

function Star({ label = 'Cheapest' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800 dark:bg-slate-800 dark:text-brand-100">
      <span aria-hidden="true">★</span>
      {label}
    </span>
  );
}

function Badge({
  children,
  tone = 'slate',
}: {
  children: string;
  tone?: 'slate' | 'amber' | 'brand';
}) {
  const cls =
    tone === 'amber'
      ? 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100'
      : tone === 'brand'
        ? 'bg-brand-50 text-brand-800 dark:bg-slate-800 dark:text-brand-100'
        : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

/** Complete stores by total first, then incomplete by fewest missing. */
function ranked(totals: readonly StoreTotal[]): StoreTotal[] {
  return [...totals].sort(
    (a, b) =>
      Number(b.complete) - Number(a.complete) ||
      a.missingCount - b.missingCount ||
      a.totalCents - b.totalCents,
  );
}

function Summary({
  data,
  name,
}: {
  data: ComparisonResponse;
  name: (id: number | null) => string;
}) {
  const baselineName = name(data.baseline.storeId);
  return (
    <section aria-labelledby="sum-h" className={`${card} space-y-3`}>
      <h2 id="sum-h" className="text-lg font-semibold">
        Store totals
      </h2>
      {data.baseline.storeId !== null ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Savings are measured against {baselineName}
          {data.baseline.source === 'user' ? ' (your usual store)' : ' (the middle-priced store)'}.
        </p>
      ) : null}
      {data.cheapestStoreId === null ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          No single store carries everything on this list.
        </p>
      ) : null}
      <ol
        className="divide-y divide-slate-200 dark:divide-slate-800"
        aria-label="Store totals, cheapest first"
      >
        {ranked(data.totals).map((t) => {
          const isCheapest = t.storeId === data.cheapestStoreId;
          const isBaseline = t.storeId === data.baseline.storeId;
          return (
            <li
              key={t.storeId}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2"
              data-store={name(t.storeId)}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{name(t.storeId)}</span>
                {isCheapest ? <Star /> : null}
                {isBaseline ? <Badge>usual store</Badge> : null}
              </span>
              <span className="text-right">
                <span className="block font-semibold tabular-nums">
                  {formatMoney(t.totalCents)}
                </span>
                <span className="block text-sm text-slate-600 dark:text-slate-400">
                  {!t.complete ? (
                    <>
                      <span aria-hidden="true">⚠ </span>
                      {t.missingCount} item{t.missingCount === 1 ? '' : 's'} missing
                    </>
                  ) : t.savingsCents === null || t.savingsPct === null || isBaseline ? (
                    'All items'
                  ) : t.savingsCents >= 0 ? (
                    `Save ${formatMoney(t.savingsCents)} (${formatPct(t.savingsPct)})`
                  ) : (
                    `${formatMoney(-t.savingsCents)} (${formatPct(t.savingsPct)}) more`
                  )}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function StoreRow({
  s,
  line,
  name,
  cheapest,
}: {
  s: LineAtStore;
  line: CompareLineResult;
  name: string;
  cheapest: boolean;
}) {
  const p = line.product;
  if (s.status === 'missing' || s.lineCents === null || !p) {
    return (
      <li className="flex justify-between gap-2 py-1.5 text-sm text-slate-500 dark:text-slate-400">
        <span>{name}</span>
        <span>Not carried</span>
      </li>
    );
  }
  const pkg = s.packages === null ? 'by weight' : `${String(s.packages)} pkg`;
  return (
    <li className="space-y-0.5 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{name}</span>
          {cheapest ? <Star /> : null}
        </span>
        <span className="font-semibold tabular-nums">{formatMoney(s.lineCents)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
        <span>{s.title}</span>
        <span>
          · {pkg} · {formatUnitPrice(s.unitPriceCents ?? 0, p.displayUnit)}
        </span>
        {s.onSale ? <Badge tone="brand">{s.promoLabel ?? 'Sale'}</Badge> : null}
        {s.approximate ? <Badge tone="amber">≈ estimated by weight</Badge> : null}
        {s.overbuy > 0.0001 ? (
          <span>
            +{formatNumber(s.overbuy)} {UNIT_LABEL[p.displayUnit]} extra
          </span>
        ) : null}
      </div>
    </li>
  );
}

function LineCard({ line, name }: { line: CompareLineResult; name: (id: number) => string }) {
  const title = line.product?.name ?? line.rawText;
  const qty = formatQuantity(line);
  const rows = [...line.stores].sort(
    (a, b) => (a.lineCents ?? Infinity) - (b.lineCents ?? Infinity) || a.storeId - b.storeId,
  );
  return (
    <li className={card}>
      <h3 className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">
          {title}
          {qty ? (
            <span className="ml-2 text-sm font-normal text-slate-600 dark:text-slate-400">
              {qty}
            </span>
          ) : null}
        </span>
        {line.product ? (
          <Link
            to={`/products/${line.product.id}`}
            className="text-sm font-medium text-brand-700 underline dark:text-brand-100"
          >
            All prices <span className="sr-only">for {title}</span>
          </Link>
        ) : null}
      </h3>
      <ul
        className="mt-1 divide-y divide-slate-100 dark:divide-slate-800"
        aria-label={`${title} by store`}
      >
        {rows.map((s) => (
          <StoreRow
            key={s.storeId}
            s={s}
            line={line}
            name={name(s.storeId)}
            cheapest={line.cheapestStoreIds.includes(s.storeId)}
          />
        ))}
      </ul>
    </li>
  );
}

export function CompareListPage() {
  const { id = '' } = useParams();
  const [selected, setSelected] = useState<number[] | null>(null);
  const q = useComparison(id, selected);
  if (q.isPending) return <Spinner label="Comparing prices…" />;
  if (q.isError) return <FormError message={message(q.error)} />;
  const data = q.data;
  const storeName = new Map(data.stores.map((s) => [s.id, s.name]));
  const name = (sid: number | null) => (sid === null ? '' : (storeName.get(sid) ?? '?'));
  // The user's selection drives the checkboxes immediately; the server answer follows.
  const included = new Set(
    selected ?? data.available.filter((a) => a.included).map((a) => a.storeId),
  );
  const priced = data.lines.filter((l) => !l.unpriced);
  const unpriced = data.lines.filter((l) => l.unpriced);
  const asOf = new Date(`${data.asOf}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const toggle = (storeId: number, on: boolean) => {
    const next = data.available
      .map((a) => a.storeId)
      .filter((sid) => (sid === storeId ? on : included.has(sid)));
    if (next.length > 0) setSelected(next);
  };

  return (
    <section aria-labelledby="cmp-h" className="space-y-4">
      <p>
        <Link
          to={`/lists/${data.listId}`}
          className="text-sm font-medium text-brand-700 underline dark:text-brand-100"
        >
          ← {data.listName}
        </Link>
      </p>
      <div>
        <h1 id="cmp-h" className="text-2xl font-bold tracking-tight">
          Compare prices
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {data.listName} · prices as of {asOf}
          {q.isFetching ? ' · updating…' : ''}
        </p>
      </div>
      {data.cheapestStoreId !== null &&
      data.savingsPct !== null &&
      data.savingsCents !== null &&
      data.savingsCents > 0 ? (
        <p
          role="status"
          className="rounded-2xl bg-brand-50 p-4 text-brand-900 dark:bg-slate-900 dark:text-brand-100"
        >
          <span aria-hidden="true">★ </span>
          <strong>{name(data.cheapestStoreId)}</strong> is cheapest for this list: save{' '}
          <strong>{formatMoney(data.savingsCents)}</strong> ({formatPct(data.savingsPct)}) vs{' '}
          {name(data.baseline.storeId)}.
        </p>
      ) : null}
      <fieldset className={`${card} space-y-2`}>
        <legend className="sr-only">Stores to compare</legend>
        <p aria-hidden="true" className="text-sm font-semibold">
          Stores to compare
        </p>
        <div className="flex flex-wrap gap-2">
          {data.available.map((a) => (
            <label
              key={a.storeId}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-slate-300 px-3 has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50 dark:border-slate-700 dark:has-[:checked]:bg-slate-800"
            >
              <input
                type="checkbox"
                className="size-4 accent-brand-700"
                checked={included.has(a.storeId)}
                disabled={included.has(a.storeId) && included.size === 1}
                onChange={(e) => {
                  toggle(a.storeId, e.target.checked);
                }}
              />
              {name(a.storeId)}
            </label>
          ))}
        </div>
        {data.excluded.some((e) => e.reason === 'no_membership') ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Not shown (no membership):{' '}
            {data.excluded
              .filter((e) => e.reason === 'no_membership')
              .map((e) => name(e.storeId))
              .join(', ')}
            .{' '}
            <Link to="/settings" className="underline">
              Update memberships
            </Link>
          </p>
        ) : null}
      </fieldset>
      <Summary data={data} name={name} />
      <LogTrip data={data} name={name} />
      <section aria-labelledby="items-h" className="space-y-3">
        <h2 id="items-h" className="text-lg font-semibold">
          Item by item
        </h2>
        <ul className="space-y-3">
          {priced.map((l) => (
            <LineCard key={l.itemId} line={l} name={(sid) => name(sid)} />
          ))}
        </ul>
        {unpriced.length > 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Not priced (no matching product): {unpriced.map((l) => l.rawText).join(', ')}
          </p>
        ) : null}
      </section>
    </section>
  );
}

/** "I shopped this": commit the list as a trip at 1–3 stores (SPEC Phase 6). */
function LogTrip({
  data,
  name,
}: {
  data: ComparisonResponse;
  name: (id: number | null) => string;
}) {
  const options = ranked(data.totals).filter((t) => t.pricedCount > 0);
  const first = data.cheapestStoreId ?? options[0]?.storeId;
  const [chosen, setChosen] = useState<number[]>(first === undefined ? [] : [first]);
  const today = chicagoToday();
  const [day, setDay] = useState(today);
  const commit = useCommitTrip();
  const dateId = useId();
  if (options.length === 0 || data.baseline.storeId === null) return null;
  const toggle = (id: number, on: boolean) => {
    setChosen((cur) => (on ? [...cur, id].slice(0, 3) : cur.filter((x) => x !== id)));
  };
  const saved = commit.data;
  return (
    <section aria-labelledby="log-h" className={`${card} space-y-3`}>
      <h2 id="log-h" className="text-lg font-semibold">
        I shopped this
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Log a trip to track your savings. We price the list on the day you shopped and, with more
        than one store, buy each item where it was cheaper. Savings are measured against{' '}
        {name(data.baseline.storeId)}.
      </p>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Where did you shop? (up to 3)</legend>
        <div className="flex flex-wrap gap-2">
          {options.map((t) => {
            const on = chosen.includes(t.storeId);
            return (
              <label
                key={t.storeId}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-slate-300 px-3 has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50 dark:border-slate-700 dark:has-[:checked]:bg-slate-800"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-brand-700"
                  checked={on}
                  disabled={!on && chosen.length >= 3}
                  onChange={(e) => {
                    toggle(t.storeId, e.target.checked);
                  }}
                />
                {name(t.storeId)}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor={dateId} className="text-sm font-semibold">
          Date shopped
        </label>
        <input
          id={dateId}
          type="date"
          value={day}
          min={addDaysIso(today, -365)}
          max={today}
          onChange={(e) => {
            setDay(e.target.value);
          }}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
        />
      </div>
      <button
        type="button"
        className={primaryButton}
        disabled={chosen.length === 0 || commit.isPending}
        onClick={() => {
          commit.mutate({ listId: data.listId, plan: { storeIds: chosen }, shoppedOn: day });
        }}
      >
        {commit.isPending ? 'Saving trip…' : 'Save trip'}
      </button>
      <FormError message={message(commit.error)} />
      {saved ? (
        <p
          role="status"
          className="rounded-xl bg-brand-50 p-3 text-brand-900 dark:bg-slate-800 dark:text-brand-100"
        >
          Trip saved:{' '}
          {saved.savingsCents >= 0 ? (
            <>
              you saved <strong>{formatMoney(saved.savingsCents)}</strong>
            </>
          ) : (
            <>
              you spent <strong>{formatMoney(-saved.savingsCents)}</strong> more
            </>
          )}{' '}
          vs {saved.baselineStore.name} (incl. {formatMoney(saved.fuelCostCents)} fuel).{' '}
          <Link to={`/trips/${saved.id}`} className="font-medium underline">
            View trip
          </Link>{' '}
          ·{' '}
          <Link to="/dashboard" className="font-medium underline">
            Dashboard
          </Link>
        </p>
      ) : null}
    </section>
  );
}

/** /compare: pick which list to compare. */
export function ComparePickerPage() {
  const lists = useLists();
  return (
    <section aria-labelledby="pick-h" className="space-y-4">
      <h1 id="pick-h" className="text-2xl font-bold tracking-tight">
        Compare
      </h1>
      <p className="text-slate-700 dark:text-slate-300">
        Pick a list to compare across your stores.
      </p>
      {lists.isPending ? (
        <Spinner label="Loading lists…" />
      ) : lists.isError ? (
        <FormError message={message(lists.error)} />
      ) : lists.data.lists.length === 0 ? (
        <p>
          No lists yet.{' '}
          <Link to="/" className="underline">
            Create one
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-3">
          {lists.data.lists.map((l) => (
            <li key={l.id}>
              <Link
                to={`/lists/${l.id}/compare`}
                className={`${card} block hover:border-brand-600`}
              >
                <span className="block font-semibold">{l.name}</span>
                <span className="block text-sm text-slate-600 dark:text-slate-400">
                  {l.itemCount} items
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
