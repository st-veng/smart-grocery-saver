import type { OptimizedPlan, OptimizeResponse } from '@sgs/shared';
import { useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Segmented } from '../components/Segmented';
import { card, FormError, primaryButton, Spinner } from '../components/ui';
import { ApiError } from '../lib/api';
import { formatMoney } from '../lib/format';
import { addDaysIso, chicagoToday, useCommitTrip, useOptimize } from '../lib/trips';

const message = (e: unknown) =>
  e instanceof ApiError ? e.message : e ? 'Something went wrong' : null;

const TIME_KEY = 'sgs-plan-time';
interface TimePrefs {
  on: boolean;
  dollarsPerHour: string;
  minutesPerStop: string;
}
/** Per-viewer convenience only; the page works without storage. */
function loadTime(): TimePrefs {
  try {
    const raw = localStorage.getItem(TIME_KEY);
    if (raw)
      return {
        on: false,
        dollarsPerHour: '15',
        minutesPerStop: '10',
        ...(JSON.parse(raw) as Partial<TimePrefs>),
      };
  } catch {
    // storage blocked: defaults
  }
  return { on: false, dollarsPerHour: '15', minutesPerStop: '10' };
}
function saveTime(t: TimePrefs) {
  try {
    localStorage.setItem(TIME_KEY, JSON.stringify(t));
  } catch {
    // storage blocked: fine
  }
}

const planKey = (p: OptimizedPlan) => (p.storeIds.length ? p.storeIds.join('-') : 'none');

export function verdictText(r: OptimizeResponse, name: (id: number) => string): string {
  const rec = r.recommendation;
  const best = r.multi[0];
  if (r.single.storeIds.length === 0) return 'Nothing on this list can be priced yet.';
  if (rec.kind === 'multi' && best) {
    const stores = best.route.map(name).join(' + ');
    if (rec.reason === 'coverage') {
      const more = r.single.missing.length - best.missing.length;
      return `Go to ${stores}: together they have ${String(more)} more ${more === 1 ? 'item' : 'items'} than any one store.`;
    }
    return `The extra stop is worth it: ${stores} saves ${formatMoney(rec.extraStopSavingsCents ?? 0)} more than ${name(r.single.storeIds[0] ?? 0)} alone, after fuel.`;
  }
  if (rec.reason === 'not_worth_it' && best) {
    const extra = rec.extraStopSavingsCents ?? 0;
    return extra > 0
      ? `One store is enough: a second stop would save only ${formatMoney(extra)} after fuel (we suggest it from ${formatMoney(rec.thresholdCents)}).`
      : 'One store is enough: a second stop would cost more after fuel.';
  }
  return `${name(r.single.storeIds[0] ?? 0)} is your best option.`;
}

function PlanSummary({
  p,
  name,
  baseline,
}: {
  p: OptimizedPlan;
  name: (id: number) => string;
  baseline: string | null;
}) {
  const s = p.savingsVsBaselineCents;
  return (
    <span className="block space-y-0.5">
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{p.route.map(name).join(' → ')}</span>
        <span className="font-semibold tabular-nums">{formatMoney(p.totalCents)}</span>
      </span>
      <span className="block text-sm text-slate-600 dark:text-slate-400">
        {formatMoney(p.itemsCents)} groceries · {p.distanceMiles.toFixed(1)} mi,{' '}
        {formatMoney(p.fuelCents)} fuel
        {p.timeCents > 0 ? ` · ${formatMoney(p.timeCents)} time` : ''}
      </span>
      {s !== null && baseline ? (
        <span className="block text-sm font-medium">
          {s >= 0 ? `Save ${formatMoney(s)}` : `${formatMoney(-s)} more`} vs {baseline}
        </span>
      ) : null}
      {p.missing.length > 0 ? (
        <span className="block text-sm text-amber-900 dark:text-amber-200">
          <span aria-hidden="true">⚠ </span>
          {p.missing.length} {p.missing.length === 1 ? 'item' : 'items'} not available
        </span>
      ) : null}
    </span>
  );
}

function PlanDetail({ p, name }: { p: OptimizedPlan; name: (id: number) => string }) {
  return (
    <section aria-labelledby="route-h" className={`${card} space-y-3`}>
      <h2 id="route-h" className="text-lg font-semibold">
        Route and shopping list
      </h2>
      <ol className="space-y-3">
        <li className="text-sm text-slate-600 dark:text-slate-400">Start at home</li>
        {p.route.map((id, i) => {
          const here = p.assignments.filter((a) => a.storeId === id);
          return (
            <li key={id}>
              <h3 className="font-semibold">
                {i + 1}. {name(id)}{' '}
                <span className="font-normal text-slate-600 dark:text-slate-400">
                  · {here.length} {here.length === 1 ? 'item' : 'items'},{' '}
                  {formatMoney(here.reduce((t, a) => t + a.lineCents, 0))}
                </span>
              </h3>
              <ul className="mt-1 divide-y divide-slate-200 text-sm dark:divide-slate-800">
                {here.map((a) => (
                  <li key={a.itemId} className="flex justify-between gap-2 py-1">
                    <span>
                      {a.productName}
                      <span className="block text-slate-600 dark:text-slate-400">
                        {a.title}
                        {a.packages !== null ? ` × ${String(a.packages)}` : ''}
                      </span>
                    </span>
                    <span className="tabular-nums">{formatMoney(a.lineCents)}</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
        <li className="text-sm text-slate-600 dark:text-slate-400">
          Back home · {p.distanceMiles.toFixed(1)} mi round trip
        </li>
      </ol>
      {p.missing.length > 0 ? (
        <p className="text-sm">
          Not available at these stores: {p.missing.map((m) => m.rawText).join(', ')}
        </p>
      ) : null}
    </section>
  );
}

/** S8: one store or several? */
export function PlanPage() {
  const { id = '' } = useParams();
  const [maxStores, setMaxStores] = useState<'1' | '2' | '3'>('3');
  const [time, setTimeState] = useState<TimePrefs>(loadTime);
  const setTime = (t: TimePrefs) => {
    setTimeState(t);
    saveTime(t);
  };
  const rate = Math.round(Number(time.dollarsPerHour) * 100);
  const mins = Math.round(Number(time.minutesPerStop));
  const timeValid = !time.on || (rate >= 0 && rate <= 20_000 && mins >= 0 && mins <= 120);
  const body = {
    maxStores: Number(maxStores),
    ...(time.on && timeValid ? { timeValueCentsPerHour: rate, minutesPerStop: mins } : {}),
  };
  const q = useOptimize(id, body);
  const [picked, setPicked] = useState<string | null>(null);
  const today = chicagoToday();
  const [day, setDay] = useState(today);
  const commit = useCommitTrip();
  const ids = { rate: useId(), mins: useId(), day: useId() };

  if (q.isPending) return <Spinner label="Working out the best plan…" />;
  if (q.isError) return <FormError message={message(q.error)} />;
  const r = q.data;
  const storeName = new Map(r.stores.map((s) => [s.id, s.name]));
  const name = (sid: number) => storeName.get(sid) ?? '?';
  const plans = [r.single, ...r.multi].filter((p) => p.storeIds.length > 0);
  const recommended = r.recommendation.kind === 'multi' && r.multi[0] ? r.multi[0] : r.single;
  const chosen = plans.find((p) => planKey(p) === picked) ?? recommended;
  const saved = commit.data;

  return (
    <section aria-labelledby="plan-h" className="space-y-4">
      <p>
        <Link
          to={`/lists/${r.listId}/compare`}
          className="text-sm font-medium text-brand-700 underline dark:text-brand-100"
        >
          ← Compare {r.listName}
        </Link>
      </p>
      <div>
        <h1 id="plan-h" className="text-2xl font-bold tracking-tight">
          Plan your trip
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {r.listName} · {r.settings.mpg} mpg at {formatMoney(r.settings.fuelCentsPerGal)}/gal ·{' '}
          <Link to="/settings" className="underline">
            change
          </Link>
          {q.isFetching ? ' · updating…' : ''}
        </p>
      </div>

      <div className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold" aria-hidden="true">
            Stops
          </span>
          <Segmented
            legend="Most stores to visit"
            options={[
              { value: '1', label: '1 store' },
              { value: '2', label: 'Up to 2' },
              { value: '3', label: 'Up to 3' },
            ]}
            value={maxStores}
            onChange={(v) => {
              setMaxStores(v);
              setPicked(null);
            }}
          />
        </div>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-brand-700"
            checked={time.on}
            onChange={(e) => {
              setTime({ ...time, on: e.target.checked });
            }}
          />
          Count my time
        </label>
        {time.on ? (
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.rate} className="text-sm font-semibold">
                $ per hour
              </label>
              <input
                id={ids.rate}
                inputMode="decimal"
                value={time.dollarsPerHour}
                onChange={(e) => {
                  setTime({ ...time, dollarsPerHour: e.target.value });
                }}
                aria-invalid={!timeValid}
                className="min-h-11 w-28 rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.mins} className="text-sm font-semibold">
                Minutes per stop
              </label>
              <input
                id={ids.mins}
                inputMode="numeric"
                value={time.minutesPerStop}
                onChange={(e) => {
                  setTime({ ...time, minutesPerStop: e.target.value });
                }}
                aria-invalid={!timeValid}
                className="min-h-11 w-28 rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            {!timeValid ? <FormError message="Use $0–$200 an hour and 0–120 minutes." /> : null}
          </div>
        ) : null}
      </div>

      {plans.length === 0 ? (
        <p className={card}>
          Nothing on this list can be priced at your stores yet.{' '}
          <Link to={`/lists/${r.listId}`} className="underline">
            Edit the list
          </Link>
        </p>
      ) : (
        <>
          <p
            role="status"
            className="rounded-2xl bg-brand-50 p-4 text-brand-900 dark:bg-slate-900 dark:text-brand-100"
          >
            <span aria-hidden="true">{r.recommendation.kind === 'multi' ? '✓ ' : '★ '}</span>
            {verdictText(r, name)}
          </p>
          <fieldset className="space-y-2">
            <legend className="text-lg font-semibold">Plans</legend>
            {plans.map((p) => {
              const key = planKey(p);
              const isRec = planKey(recommended) === key;
              return (
                <label
                  key={key}
                  className={`${card} flex cursor-pointer gap-3 has-[:checked]:border-brand-700 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-700`}
                >
                  <input
                    type="radio"
                    name="plan"
                    className="mt-1 size-4 accent-brand-700"
                    checked={planKey(chosen) === key}
                    onChange={() => {
                      setPicked(key);
                    }}
                  />
                  <span className="flex-1 space-y-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">
                        {p.storeIds.length === 1
                          ? '1 store'
                          : `${String(p.storeIds.length)} stores`}
                      </span>
                      {isRec ? (
                        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800 dark:bg-slate-800 dark:text-brand-100">
                          <span aria-hidden="true">★ </span>Recommended
                        </span>
                      ) : null}
                    </span>
                    <PlanSummary p={p} name={name} baseline={r.baselineStore?.name ?? null} />
                  </span>
                </label>
              );
            })}
          </fieldset>
          <PlanDetail p={chosen} name={name} />
          <section aria-labelledby="shop-h" className={`${card} space-y-3`}>
            <h2 id="shop-h" className="text-lg font-semibold">
              I shopped this
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Logs this plan ({chosen.route.map(name).join(' → ')}) as a trip on your savings
              dashboard.
            </p>
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.day} className="text-sm font-semibold">
                Date shopped
              </label>
              <input
                id={ids.day}
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
              disabled={commit.isPending || r.baselineStore === null}
              onClick={() => {
                commit.mutate({
                  listId: r.listId,
                  plan: { storeIds: chosen.storeIds },
                  shoppedOn: day,
                });
              }}
            >
              {commit.isPending ? 'Saving trip…' : 'I shopped this'}
            </button>
            {r.baselineStore === null ? (
              <p className="text-sm">
                None of your stores carries every item, so there’s no usual-store price to measure
                savings against.
              </p>
            ) : null}
            <FormError message={message(commit.error)} />
            {saved ? (
              <p
                role="status"
                className="rounded-xl bg-brand-50 p-3 text-brand-900 dark:bg-slate-800 dark:text-brand-100"
              >
                Trip saved:{' '}
                {saved.savingsCents >= 0
                  ? `you saved ${formatMoney(saved.savingsCents)}`
                  : `you spent ${formatMoney(-saved.savingsCents)} more`}{' '}
                vs {saved.baselineStore.name}.{' '}
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
        </>
      )}
    </section>
  );
}
