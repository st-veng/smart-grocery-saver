import { useState } from 'react';
import { useReady } from './HealthStatus';

const KEY = 'sgs-demo-banner-dismissed';

function dismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** "Demo prices" banner while the mock provider is active (Q-9). Dismissible per session. */
export function DemoBanner() {
  const q = useReady();
  const [dismissed, setDismissed] = useState(dismissedThisSession);
  if (dismissed || q.data?.priceProvider !== 'mock') return null;
  return (
    <div
      role="note"
      aria-label="Demo prices"
      className="flex items-center justify-between gap-3 bg-amber-100 px-4 py-2 text-sm text-amber-950 dark:bg-amber-900/60 dark:text-amber-50"
    >
      <p>
        <strong>Demo prices:</strong> not real store prices.
      </p>
      <button
        type="button"
        aria-label="Dismiss demo prices notice"
        onClick={() => {
          try {
            sessionStorage.setItem(KEY, '1');
          } catch {
            // ignore: storage unavailable
          }
          setDismissed(true);
        }}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-amber-200 dark:hover:bg-amber-800"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
