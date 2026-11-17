import { Link } from 'react-router';

const card =
  'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900';

export function NotFoundPage() {
  return (
    <section aria-labelledby="nf-title" className="space-y-4">
      <h1 id="nf-title" className="text-2xl font-bold tracking-tight">
        Page not found
      </h1>
      <div className={card}>
        <p className="text-slate-700 dark:text-slate-300">
          That page doesn’t exist.{' '}
          <Link to="/" className="font-medium underline">
            Go to your lists
          </Link>
        </p>
      </div>
    </section>
  );
}
