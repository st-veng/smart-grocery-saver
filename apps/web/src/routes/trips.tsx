import type { TripSummary } from '@sgs/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { card, FormError, secondaryButton, Spinner } from '../components/ui';
import { ApiError } from '../lib/api';
import { formatMoney, formatUnitPrice } from '../lib/format';
import { useDeleteTrip, useTrip, useTrips } from '../lib/trips';

const message = (e: unknown) =>
  e instanceof ApiError ? e.message : e ? 'Something went wrong' : null;

const longDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Never colour alone: the words say which way it went. */
export function savedText(cents: number): string {
  return cents >= 0 ? `Saved ${formatMoney(cents)}` : `Spent ${formatMoney(-cents)} more`;
}

function TripRow({ t }: { t: TripSummary }) {
  return (
    <li>
      <Link
        to={`/trips/${t.id}`}
        className={`${card} flex items-center justify-between gap-3 hover:border-brand-700`}
      >
        <span className="min-w-0">
          <span className="block font-semibold">{longDate(t.shoppedOn)}</span>
          <span className="block truncate text-sm text-slate-600 dark:text-slate-400">
            {t.stores.map((s) => s.name).join(' + ')} · {t.listName} · {t.itemCount} items
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-semibold tabular-nums">
            {formatMoney(t.itemsTotalCents + t.fuelCostCents)}
          </span>
          <span
            className={`block text-sm tabular-nums ${t.savingsCents >= 0 ? 'text-brand-800 dark:text-brand-100' : 'text-slate-700 dark:text-slate-300'}`}
          >
            {savedText(t.savingsCents)}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** S13: trip history. */
export function TripsPage() {
  const q = useTrips();
  return (
    <section aria-labelledby="trips-h" className="space-y-4">
      <p>
        <Link
          to="/dashboard"
          className="text-sm font-medium text-brand-700 underline dark:text-brand-100"
        >
          ← Savings
        </Link>
      </p>
      <h1 id="trips-h" className="text-2xl font-bold tracking-tight">
        Trip history
      </h1>
      {q.isPending ? (
        <Spinner label="Loading trips…" />
      ) : q.isError ? (
        <FormError message={message(q.error)} />
      ) : q.data.trips.length === 0 ? (
        <p className={card}>
          No trips yet. Compare a list and use “I shopped this” to log one.{' '}
          <Link to="/compare" className="underline">
            Compare a list
          </Link>
        </p>
      ) : (
        <>
          <ul className="space-y-2" aria-label="Trips, newest first">
            {q.data.trips.map((t) => (
              <TripRow key={t.id} t={t} />
            ))}
          </ul>
          {q.data.nextCursor ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Showing your latest 100 trips. Export a CSV from the dashboard for the rest.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** S13 detail: the immutable snapshot of a committed trip. */
export function TripDetailPage() {
  const { id = '' } = useParams();
  const q = useTrip(id);
  const del = useDeleteTrip();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  if (q.isPending) return <Spinner label="Loading trip…" />;
  if (q.isError) return <FormError message={message(q.error)} />;
  const t = q.data;
  const storeName = new Map(t.stores.map((s) => [s.id, s.name]));
  return (
    <section aria-labelledby="trip-h" className="space-y-4">
      <p>
        <Link
          to="/trips"
          className="text-sm font-medium text-brand-700 underline dark:text-brand-100"
        >
          ← Trip history
        </Link>
      </p>
      <div>
        <h1 id="trip-h" className="text-2xl font-bold tracking-tight">
          {longDate(t.shoppedOn)}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {t.listName} · prices as of {longDate(t.priceAsOf)}
        </p>
      </div>
      <section aria-labelledby="trip-sum-h" className={`${card} space-y-2`}>
        <h2 id="trip-sum-h" className="text-lg font-semibold">
          {savedText(t.savingsCents)} vs {t.baselineStore.name}
        </h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
          <dt>Groceries ({t.itemCount} items)</dt>
          <dd className="text-right">{formatMoney(t.itemsTotalCents)}</dd>
          <dt>
            Fuel ({t.distanceMiles.toFixed(1)} mi round trip, {t.mpg} mpg at{' '}
            {formatMoney(t.fuelCentsPerGal)}/gal)
          </dt>
          <dd className="text-right">{formatMoney(t.fuelCostCents)}</dd>
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold">
            {formatMoney(t.itemsTotalCents + t.fuelCostCents)}
          </dd>
          <dt>Same items at {t.baselineStore.name}</dt>
          <dd className="text-right">{formatMoney(t.baselineTotalCents)}</dd>
        </dl>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Route: Home → {t.stores.map((s) => s.name).join(' → ')} → Home
        </p>
      </section>
      <section aria-labelledby="trip-items-h" className="space-y-2">
        <h2 id="trip-items-h" className="text-lg font-semibold">
          What you bought
        </h2>
        <ul className="space-y-2">
          {t.items.map((i) => {
            const diff = i.baselineLineCents - i.lineCents;
            return (
              <li key={i.itemId} className={card}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{i.productName}</span>
                  <span className="font-semibold tabular-nums">{formatMoney(i.lineCents)}</span>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {storeName.get(i.storeId)} · {i.title}
                  {i.packages !== null ? ` × ${String(i.packages)}` : ''} ·{' '}
                  {formatUnitPrice(i.unitPriceCents, i.displayUnit)}
                  {i.promoLabel ? ` · ${i.promoLabel}` : ''}
                  {i.approximate ? ' · ≈ estimated by weight' : ''}
                </p>
                <p className="text-sm tabular-nums">
                  {t.baselineStore.name}: {formatMoney(i.baselineLineCents)} ·{' '}
                  {diff >= 0 ? `saved ${formatMoney(diff)}` : `${formatMoney(-diff)} more`}
                </p>
              </li>
            );
          })}
        </ul>
        {t.skipped.length > 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Not counted: {t.skipped.map((s) => s.rawText).join(', ')} (not priced at these stores or
            at {t.baselineStore.name}).
          </p>
        ) : null}
      </section>
      <div className="flex flex-wrap gap-2">
        {confirming ? (
          <>
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-red-700 px-4 font-semibold text-white hover:bg-red-800"
              disabled={del.isPending}
              onClick={() => {
                del.mutate(t.id, {
                  onSuccess: () => {
                    void navigate('/trips');
                  },
                });
              }}
            >
              Yes, delete this trip
            </button>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Delete trip
          </button>
        )}
      </div>
      <FormError message={message(del.error)} />
    </section>
  );
}
