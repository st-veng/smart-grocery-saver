import { Link, useNavigate } from 'react-router';
import { ProductSearch } from '../components/ProductSearch';
import { card } from '../components/ui';
import { useAlerts, useNotifications } from '../lib/history';
import { notificationText } from './notifications';

/** Deals & History tab: find a product's price history, see recent alert hits. */
export function DealsPage() {
  const navigate = useNavigate();
  const notes = useNotifications();
  const alerts = useAlerts();
  const recent = notes.data?.notifications.slice(0, 3) ?? [];
  return (
    <section aria-labelledby="deals-h" className="space-y-4">
      <h1 id="deals-h" className="text-2xl font-bold tracking-tight">
        Deals & History
      </h1>
      <div className={`${card} space-y-2`}>
        <p className="font-semibold">Look up a product’s price history</p>
        <ProductSearch
          onPick={(p) => {
            void navigate(`/products/${p.id}`);
          }}
          onFreeText={() => undefined}
        />
      </div>
      <div className={`${card} space-y-2`}>
        <h2 className="text-lg font-semibold">Recent price drops</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Nothing yet. You’re watching {alerts.data?.filter((a) => a.active).length ?? 0}{' '}
            product(s).
          </p>
        ) : (
          <ul className="space-y-2">
            {recent.map((n) => (
              <li key={n.id} className="text-sm">
                <Link to={`/products/${n.productId}`} className="underline">
                  {notificationText(n)}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link
          to="/notifications"
          className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline dark:text-brand-100"
        >
          All notifications and alerts
        </Link>
      </div>
    </section>
  );
}
