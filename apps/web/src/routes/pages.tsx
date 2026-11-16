import { HealthStatus } from '../components/HealthStatus';

const card =
  'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900';

export function HomePage() {
  return (
    <section aria-labelledby="home-title" className="space-y-4">
      <h1 id="home-title" className="text-2xl font-bold tracking-tight">
        My Lists
      </h1>
      <div className={card}>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          System status
        </h2>
        <HealthStatus />
      </div>
      <div className={card}>
        <p className="text-slate-700 dark:text-slate-300">
          Compare prices across Walmart, Costco, Sam&apos;s Club, Target, Kroger, H-E-B, Aldi, Tom
          Thumb, Sprouts and Trader Joe&apos;s. Grocery lists arrive in Phase 3.
        </p>
      </div>
    </section>
  );
}

export function PlaceholderPage({ title, phase }: { title: string; phase: number }) {
  return (
    <section aria-labelledby="ph-title" className="space-y-4">
      <h1 id="ph-title" className="text-2xl font-bold tracking-tight">
        {title}
      </h1>
      <div className={card}>
        <p className="text-slate-700 dark:text-slate-300">Coming in Phase {phase}.</p>
      </div>
    </section>
  );
}

export function NotFoundPage() {
  return <PlaceholderPage title="Page not found" phase={0} />;
}
