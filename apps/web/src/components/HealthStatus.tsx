import { useQuery } from '@tanstack/react-query';
import { fetchReady } from '../lib/api';

export function useReady() {
  return useQuery({
    queryKey: ['health', 'ready'],
    queryFn: ({ signal }) => fetchReady(signal),
    refetchInterval: 30_000,
  });
}

export function HealthStatus() {
  const q = useReady();
  if (q.isPending) {
    return (
      <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
        Checking API…
      </p>
    );
  }
  if (q.isError) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 text-sm text-red-700 dark:text-red-300"
      >
        <span>
          <span aria-hidden="true">✕ </span>API: unreachable
        </span>
        <button
          type="button"
          onClick={() => void q.refetch()}
          className="min-h-11 rounded-full border border-red-300 px-4 font-medium hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
        >
          Retry
        </button>
      </div>
    );
  }
  const ready = q.data.status === 'ready';
  return (
    <p
      role="status"
      className={
        ready
          ? 'text-sm font-medium text-brand-700 dark:text-brand-100'
          : 'text-sm font-medium text-amber-700 dark:text-amber-300'
      }
    >
      <span aria-hidden="true">{ready ? '✓ ' : '! '}</span>
      {ready ? 'API: ok' : 'API: not ready'}
      <span className="ml-2 font-normal text-slate-600 dark:text-slate-400">
        · {q.data.metro} · {q.data.checks.migrations.applied} migration
        {q.data.checks.migrations.applied === 1 ? '' : 's'}
      </span>
    </p>
  );
}
