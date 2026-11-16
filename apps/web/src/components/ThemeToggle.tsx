import { useEffect, useState } from 'react';
import { applyTheme, nextTheme, readStoredTheme, storeTheme, type ThemePref } from '../lib/theme';

const LABEL: Record<ThemePref, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const ICON: Record<ThemePref, string> = { system: '◐', light: '☀', dark: '☾' };

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(pref);
    if (pref !== 'system' || typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      applyTheme('system');
    };
    mq.addEventListener('change', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
    };
  }, [pref]);

  const next = nextTheme(pref);
  return (
    <button
      type="button"
      onClick={() => {
        storeTheme(next);
        setPref(next);
      }}
      aria-label={`Theme: ${LABEL[pref]}. Switch to ${LABEL[next]}`}
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      <span aria-hidden="true">{ICON[pref]}</span>
      <span>{LABEL[pref]}</span>
    </button>
  );
}
