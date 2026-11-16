import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useMe } from '../lib/auth';
import { Spinner } from './ui';

function Loading() {
  return (
    <div className="mx-auto max-w-md p-6">
      <Spinner label="Loading…" />
    </div>
  );
}

/** Signed in AND onboarded; otherwise to /login (with a return path) or /onboarding. */
export function RequireUser({ children }: { children: ReactNode }) {
  const me = useMe();
  const loc = useLocation();
  if (me.isPending) return <Loading />;
  if (me.isError || !me.data) {
    const next = encodeURIComponent(loc.pathname + loc.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (!me.data.onboarded) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

/** Signed in (onboarding may be incomplete). */
export function RequireSignedIn({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) return <Loading />;
  if (me.isError || !me.data) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Login/register pages bounce signed-in users onward. */
export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const me = useMe();
  const loc = useLocation();
  if (me.isPending) return <Loading />;
  if (me.data) {
    const next = new URLSearchParams(loc.search).get('next');
    const target = me.data.onboarded ? safeNext(next) : '/onboarding';
    return <Navigate to={target} replace />;
  }
  return <>{children}</>;
}

export function safeNext(next: string | null): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/';
}
