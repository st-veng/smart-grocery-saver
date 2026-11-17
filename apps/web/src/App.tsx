import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ComponentType } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
import { AppShell } from './components/AppShell';
import { RedirectIfSignedIn, RequireSignedIn, RequireUser } from './components/Guards';
import { LoginPage, RegisterPage } from './routes/auth-pages';
import { OnboardingPage } from './routes/onboarding';
import { ComparePickerPage, CompareListPage } from './routes/compare';
import { DealsPage } from './routes/deals';
import { NotificationsPage } from './routes/notifications';
import { ListDetailPage } from './routes/list-detail';
import { ListsPage, TemplatesPage } from './routes/lists-pages';
import { NotFoundPage } from './routes/pages';
import { SettingsPage } from './routes/settings';
import { Spinner } from './components/ui';

/**
 * Screens with charts (Recharts) or used less often load on demand, so the first page a family
 * opens (their lists) doesn't download the chart library.
 */
const lazyPage =
  <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  async () => ({ Component: (await load())[name] });

export const routes: RouteObject[] = [
  {
    path: '/login',
    element: (
      <RedirectIfSignedIn>
        <LoginPage />
      </RedirectIfSignedIn>
    ),
  },
  {
    path: '/register',
    element: (
      <RedirectIfSignedIn>
        <RegisterPage />
      </RedirectIfSignedIn>
    ),
  },
  {
    path: '/onboarding',
    element: (
      <RequireSignedIn>
        <OnboardingPage />
      </RequireSignedIn>
    ),
  },
  {
    path: '/',
    element: (
      <RequireUser>
        <AppShell />
      </RequireUser>
    ),
    // Shown only while a lazy screen loads on a cold start (e.g. opening /dashboard directly).
    hydrateFallbackElement: <Spinner label="Loading…" />,
    children: [
      { index: true, element: <ListsPage /> },
      { path: 'lists/:id', element: <ListDetailPage /> },
      { path: 'lists/:id/import', lazy: lazyPage(() => import('./routes/import'), 'ImportPage') },
      { path: 'import', lazy: lazyPage(() => import('./routes/import'), 'ImportPage') },
      { path: 'templates', element: <TemplatesPage /> },
      { path: 'compare', element: <ComparePickerPage /> },
      { path: 'lists/:id/compare', element: <CompareListPage /> },
      { path: 'lists/:id/plan', lazy: lazyPage(() => import('./routes/plan'), 'PlanPage') },
      { path: 'products/:id', lazy: lazyPage(() => import('./routes/product'), 'ProductPage') },
      { path: 'deals', element: <DealsPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'dashboard', lazy: lazyPage(() => import('./routes/dashboard'), 'DashboardPage') },
      { path: 'trips', lazy: lazyPage(() => import('./routes/trips'), 'TripsPage') },
      { path: 'trips/:id', lazy: lazyPage(() => import('./routes/trips'), 'TripDetailPage') },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } });
}

export function App() {
  const [client] = useState(createQueryClient);
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
