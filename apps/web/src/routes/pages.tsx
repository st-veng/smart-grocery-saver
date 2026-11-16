const card =
  'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900';

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
