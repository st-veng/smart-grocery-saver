import { Link } from 'react-router';
import { useNotifications } from '../lib/history';

/** Header bell with unread count (SPEC §6 global shell). Count is text, not colour alone. */
export function Bell() {
  const q = useNotifications();
  const n = q.data?.unreadCount ?? 0;
  return (
    <Link
      to="/notifications"
      aria-label={n > 0 ? `Notifications, ${String(n)} unread` : 'Notifications'}
      className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
    >
      <span aria-hidden="true">🔔</span>
      {n > 0 ? (
        <span
          aria-hidden="true"
          data-testid="unread-badge"
          className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-700 px-1 text-center text-xs font-bold leading-5 text-white"
        >
          {n > 99 ? '99+' : n}
        </span>
      ) : null}
    </Link>
  );
}
