import { NavLink, Outlet, useLocation } from 'react-router';
import { DemoBanner } from './DemoBanner';
import { ThemeToggle } from './ThemeToggle';

export const NAV = [
  { to: '/', label: 'Lists', icon: '☰', end: true },
  { to: '/compare', label: 'Compare', icon: '⇄', end: false },
  { to: '/deals', label: 'Deals', icon: '🏷', end: false },
  { to: '/dashboard', label: 'Dashboard', icon: '▤', end: false },
  { to: '/settings', label: 'Settings', icon: '⚙', end: false },
] as const;

const linkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-xs font-medium md:flex-none md:flex-row md:justify-start md:gap-3 md:px-3 md:text-sm',
    isActive
      ? 'text-brand-700 md:bg-brand-50 dark:text-brand-100 md:dark:bg-slate-800'
      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
  ].join(' ');

export function AppShell() {
  const { pathname } = useLocation();
  const listsArea = /^\/(lists|templates|import)(\/|$)/.test(pathname);
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 dark:focus:bg-slate-900"
      >
        Skip to content
      </a>
      <DemoBanner />
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2">
          <p className="flex items-center gap-2 text-base font-semibold">
            <span aria-hidden="true" className="text-brand-600">
              🛒
            </span>
            Smart Grocery Saver
          </p>
          <ThemeToggle />
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-5xl flex-1">
        <nav
          aria-label="Primary"
          className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:static md:w-52 md:border-r md:border-t-0 md:bg-transparent md:p-3 dark:border-slate-800 dark:bg-slate-900 md:dark:bg-transparent"
        >
          <ul className="flex md:flex-col md:gap-1">
            {NAV.map((n) => (
              <li key={n.to} className="flex flex-1 md:flex-none">
                <NavLink
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    linkClass({ isActive: isActive || (n.to === '/' && listsArea) })
                  }
                  aria-current={n.to === '/' && listsArea ? 'page' : undefined}
                >
                  <span aria-hidden="true" className="text-lg leading-none md:text-base">
                    {n.icon}
                  </span>
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" className="min-w-0 flex-1 px-4 pb-24 pt-4 md:pb-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
