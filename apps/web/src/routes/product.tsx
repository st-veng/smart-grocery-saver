import type { HistoryRange, ProductSummary } from '@sgs/shared';
import { useId, useState, type SyntheticEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PriceChart } from '../components/PriceChart';
import { card, Field, FormError, primaryButton, secondaryButton, Spinner } from '../components/ui';
import { ApiError } from '../lib/api';
import { useMe } from '../lib/auth';
import { formatMoney, formatUnitPrice, UNIT_LABEL } from '../lib/format';
import { useAlerts, useCreateAlert, useDeleteAlert, useHistory } from '../lib/history';
import { useProductOffers } from '../lib/lists';

const message = (e: unknown) =>
  e instanceof ApiError ? e.message : e ? 'Something went wrong' : null;
const RANGES: readonly { value: HistoryRange; label: string }[] = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '365d', label: '1 year' },
];

function HistorySection({ product }: { product: ProductSummary }) {
  const [range, setRange] = useState<HistoryRange>('90d');
  const h = useHistory(product.id, range);
  const me = useMe();
  const name = (id: number) => h.data?.stores.find((s) => s.id === id)?.name ?? '';
  return (
    <section aria-labelledby="hist-h" className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="hist-h" className="text-lg font-semibold">
          Price history
        </h2>
        <fieldset className="flex rounded-full border border-slate-300 p-0.5 dark:border-slate-700">
          <legend className="sr-only">Time range</legend>
          {RANGES.map((r) => (
            <label
              key={r.value}
              className="flex min-h-10 cursor-pointer items-center rounded-full px-3 text-sm has-[:checked]:bg-slate-900 has-[:checked]:text-white dark:has-[:checked]:bg-slate-100 dark:has-[:checked]:text-slate-900"
            >
              <input
                type="radio"
                name="range"
                value={r.value}
                className="sr-only"
                checked={range === r.value}
                onChange={() => {
                  setRange(r.value);
                }}
              />
              {r.label}
            </label>
          ))}
        </fieldset>
      </div>
      {h.isPending ? (
        <Spinner label="Loading history…" />
      ) : h.isError ? (
        <FormError message={message(h.error)} />
      ) : h.data.series.length === 0 ? (
        <p className="text-slate-700 dark:text-slate-300">
          None of your stores sold this in this period.
        </p>
      ) : (
        <>
          {h.data.historicLow ? (
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {h.data.atHistoricLow ? (
                <span className="mr-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800 dark:bg-slate-800 dark:text-brand-100">
                  <span aria-hidden="true">🏷 </span>At its 1-year low
                </span>
              ) : null}
              1-year low:{' '}
              <strong>
                {formatUnitPrice(h.data.historicLow.unitPriceCents, product.displayUnit)}
              </strong>{' '}
              at {name(h.data.historicLow.storeId)} on{' '}
              {new Date(`${h.data.historicLow.date}T12:00:00Z`).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                timeZone: 'UTC',
              })}
            </p>
          ) : null}
          <PriceChart
            key={`${product.id}-${range}`}
            data={h.data}
            baselineStoreId={me.data?.baselineStoreId ?? null}
          />
        </>
      )}
    </section>
  );
}

function AlertControls({ product }: { product: ProductSummary }) {
  const alerts = useAlerts();
  const create = useCreateAlert();
  const del = useDeleteAlert();
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  const targetId = useId();
  const mine = (alerts.data ?? []).filter((a) => a.product.id === product.id && a.active);
  const low = mine.find((a) => a.kind === 'historic_low');
  const priced = mine.find((a) => a.kind === 'target_price');
  const unit = UNIT_LABEL[product.displayUnit];
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    const dollars = Number(target);
    if (!(dollars > 0)) {
      setError(`Enter a price per ${unit}`);
      return;
    }
    setError(null);
    create.mutate(
      {
        productId: product.id,
        kind: 'target_price',
        targetCents: Math.max(1, Math.round(dollars * 100)),
      },
      {
        onSuccess: () => {
          setTarget('');
        },
      },
    );
  };
  return (
    <section aria-labelledby="alert-h" className={`${card} space-y-3`}>
      <h2 id="alert-h" className="text-lg font-semibold">
        Price alerts
      </h2>
      <button
        type="button"
        aria-pressed={low !== undefined}
        className={low ? `${secondaryButton} w-full` : primaryButton}
        disabled={create.isPending || del.isPending}
        onClick={() => {
          if (low) del.mutate(low.id);
          else create.mutate({ productId: product.id, kind: 'historic_low' });
        }}
      >
        <span aria-hidden="true">🔔 </span>
        {low ? 'Alerting you at a 1-year low (tap to stop)' : 'Alert me at a 1-year low'}
      </button>
      <form onSubmit={submit} noValidate className="flex items-end gap-2">
        <div className="flex-1">
          <Field
            id={targetId}
            label={`Alert me when it drops to ($ per ${unit})`}
            inputMode="decimal"
            placeholder="e.g. 0.05"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
            }}
            error={error ?? undefined}
          />
        </div>
        <button type="submit" className={`${secondaryButton} mb-0`} disabled={create.isPending}>
          Set
        </button>
      </form>
      {priced?.targetCents ? (
        <p className="flex items-center justify-between gap-2 text-sm">
          <span>
            Target: {formatMoney(priced.targetCents)}/{unit}
          </span>
          <button
            type="button"
            className="min-h-11 px-2 font-medium underline"
            onClick={() => {
              del.mutate(priced.id);
            }}
          >
            Remove target
          </button>
        </p>
      ) : null}
      <FormError message={message(create.error ?? del.error)} />
    </section>
  );
}

/** S7: current offers, price history and alerts for one product. */
export function ProductPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const q = useProductOffers(id);
  if (q.isPending) return <Spinner label="Loading prices…" />;
  if (q.isError) return <FormError message={message(q.error)} />;
  const { product, offers, stores } = q.data;
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const best = offers[0];
  return (
    <section aria-labelledby="prod-h" className="space-y-4">
      <p>
        <button
          type="button"
          className="text-sm font-medium text-brand-700 underline dark:text-brand-100"
          onClick={() => void navigate(-1)}
        >
          ← Back
        </button>
      </p>
      <div>
        <h1 id="prod-h" className="text-2xl font-bold tracking-tight">
          {product.name}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">{product.categoryName}</p>
      </div>
      {best ? (
        <p className={`${card} text-lg`}>
          Lowest now: <strong>{storeName.get(best.storeId)}</strong> at{' '}
          <strong>{formatUnitPrice(best.unitPriceCents, product.displayUnit)}</strong>
        </p>
      ) : (
        <p className={card}>None of your stores carry this right now.</p>
      )}
      <HistorySection product={product} />
      <AlertControls product={product} />
      <section aria-labelledby="offers-h" className="space-y-2">
        <h2 id="offers-h" className="text-lg font-semibold">
          Prices today
        </h2>
        <ul
          className="space-y-2"
          aria-label={`${product.name} prices by store, lowest unit price first`}
        >
          {offers.map((o) => (
            <li key={o.storeItemId} className={card}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  {storeName.get(o.storeId)}
                  {o.cheapest ? (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800 dark:bg-slate-800 dark:text-brand-100">
                      <span aria-hidden="true">★ </span>Lowest unit price
                    </span>
                  ) : null}
                </span>
                <span className="font-semibold tabular-nums">
                  {formatMoney(o.priceCents)}
                  {o.perWeight ? '/lb' : ''}
                </span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {o.title} · {formatUnitPrice(o.unitPriceCents, product.displayUnit)}
                {o.onSale ? (
                  <>
                    {' '}
                    ·{' '}
                    <span className="font-medium text-brand-800 dark:text-brand-100">
                      {o.promoLabel ?? 'Sale'}
                    </span>{' '}
                    (reg. {formatMoney(o.regularPriceCents)})
                  </>
                ) : null}
                {o.approximate ? ' · ≈ estimated by weight' : ''}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
