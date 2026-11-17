import type { Notification } from '@sgs/shared';
import { Link } from 'react-router';
import { card, FormError, secondaryButton, Spinner } from '../components/ui';
import { ApiError } from '../lib/api';
import { formatMoney, formatUnitPrice, UNIT_LABEL } from '../lib/format';
import {
  useAlerts,
  useDeleteAlert,
  useMarkRead,
  useNotifications,
  useUpdateAlert,
} from '../lib/history';

const message = (e: unknown) =>
  e instanceof ApiError ? e.message : e ? 'Something went wrong' : null;

export function notificationText(n: Notification): string {
  const price = formatUnitPrice(n.unitPriceCents, n.displayUnit);
  if (n.kind === 'historic_low') {
    const was =
      n.priorLowCents !== null
        ? ` (previous low ${formatUnitPrice(n.priorLowCents, n.displayUnit)})`
        : '';
    return `${n.productName} hit a 1-year low at ${n.storeName}: ${price}${was}.`;
  }
  return `${n.productName} is ${price} at ${n.storeName} — at or below your ${formatMoney(n.targetCents ?? 0)}/${UNIT_LABEL[n.displayUnit]} target.`;
}

function AlertsList() {
  const alerts = useAlerts();
  const update = useUpdateAlert();
  const del = useDeleteAlert();
  if (alerts.isPending) return <Spinner label="Loading alerts…" />;
  if (alerts.isError) return <FormError message={message(alerts.error)} />;
  if (alerts.data.length === 0) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-400">
        No alerts yet. Open any product and tap “Alert me at a 1-year low”.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-200 dark:divide-slate-800" aria-label="Your alerts">
      {alerts.data.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span>
            <Link to={`/products/${a.product.id}`} className="font-medium underline">
              {a.product.name}
            </Link>
            <span className="block text-sm text-slate-600 dark:text-slate-400">
              {a.kind === 'historic_low'
                ? '1-year low'
                : `At or below ${formatMoney(a.targetCents ?? 0)}/${UNIT_LABEL[a.product.displayUnit]}`}
              {a.active ? '' : ' · paused'}
            </span>
          </span>
          <span className="flex gap-1">
            <button
              type="button"
              className="min-h-11 px-2 text-sm font-medium underline"
              onClick={() => {
                update.mutate({ id: a.id, active: !a.active });
              }}
            >
              {a.active ? 'Pause' : 'Resume'}
              <span className="sr-only"> alert for {a.product.name}</span>
            </button>
            <button
              type="button"
              className="min-h-11 px-2 text-sm font-medium text-red-700 underline dark:text-red-300"
              onClick={() => {
                del.mutate(a.id);
              }}
            >
              Remove
              <span className="sr-only"> alert for {a.product.name}</span>
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function NotificationsPage() {
  const q = useNotifications();
  const mark = useMarkRead();
  return (
    <section aria-labelledby="notif-h" className="space-y-4">
      <h1 id="notif-h" className="text-2xl font-bold tracking-tight">
        Notifications
      </h1>
      {q.isPending ? (
        <Spinner label="Loading notifications…" />
      ) : q.isError ? (
        <FormError message={message(q.error)} />
      ) : q.data.notifications.length === 0 ? (
        <p className="text-slate-700 dark:text-slate-300">
          No notifications yet. We’ll tell you here when a price you’re watching drops.
        </p>
      ) : (
        <>
          {q.data.unreadCount > 0 ? (
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                mark.mutate('all');
              }}
            >
              Mark all as read
            </button>
          ) : null}
          <ul className="space-y-2" aria-label="Notifications">
            {q.data.notifications.map((n) => (
              <li
                key={n.id}
                className={`${card} ${n.read ? '' : 'border-brand-700 dark:border-brand-600'}`}
              >
                <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                  {n.read ? null : (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800 dark:bg-slate-800 dark:text-brand-100">
                      New
                    </span>
                  )}
                  {new Date(`${n.asOf}T12:00:00Z`).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'UTC',
                  })}
                  {n.promoLabel ? ` · ${n.promoLabel}` : ''}
                </p>
                <p className="mt-1">{notificationText(n)}</p>
                <Link
                  to={`/products/${n.productId}`}
                  onClick={() => {
                    if (!n.read) mark.mutate(n.id);
                  }}
                  className="mt-2 inline-flex min-h-11 items-center font-medium text-brand-700 underline dark:text-brand-100"
                >
                  View {n.productName}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <section aria-labelledby="alerts-h" className={`${card} space-y-2`}>
        <h2 id="alerts-h" className="text-lg font-semibold">
          Your alerts
        </h2>
        <AlertsList />
      </section>
    </section>
  );
}
