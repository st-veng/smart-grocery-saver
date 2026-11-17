import { useNavigate, useParams } from 'react-router';
import { card, FormError, secondaryButton, Spinner } from '../components/ui';
import { ApiError } from '../lib/api';
import { formatMoney, formatUnitPrice } from '../lib/format';
import { useProductOffers } from '../lib/lists';

const message = (e: unknown) =>
  e instanceof ApiError ? e.message : e ? 'Something went wrong' : null;

/** S7 (Phase 4 part): current offers for one product at the user's stores. History arrives in Phase 5. */
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
              {o.title} · {o.sizeLabel} · {formatUnitPrice(o.unitPriceCents, product.displayUnit)}
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
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Price history and alerts arrive in Phase 5.
      </p>
      <button
        type="button"
        className={`${secondaryButton} w-full`}
        onClick={() => void navigate(-1)}
      >
        Back
      </button>
    </section>
  );
}
