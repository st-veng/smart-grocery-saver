import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
import { AppShell } from './components/AppShell';
import { RedirectIfSignedIn, RequireSignedIn, RequireUser } from './components/Guards';
import { LoginPage, RegisterPage } from './routes/auth-pages';
import { OnboardingPage } from './routes/onboarding';
import { ComparePickerPage, CompareListPage } from './routes/compare';
import { DealsPage } from './routes/deals';
import { ImportPage } from './routes/import';
import { NotificationsPage } from './routes/notifications';
import { ProductPage } from './routes/product';
import { ListDetailPage } from './routes/list-detail';
import { ListsPage, TemplatesPage } from './routes/lists-pages';
import { NotFoundPage, PlaceholderPage } from './routes/pages';
import { SettingsPage } from './routes/settings';

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
    children: [
      { index: true, element: <ListsPage /> },
      { path: 'lists/:id', element: <ListDetailPage /> },
      { path: 'lists/:id/import', element: <ImportPage /> },
      { path: 'import', element: <ImportPage /> },
      { path: 'templates', element: <TemplatesPage /> },
      { path: 'compare', element: <ComparePickerPage /> },
      { path: 'lists/:id/compare', element: <CompareListPage /> },
      { path: 'products/:id', element: <ProductPage /> },
      { path: 'deals', element: <DealsPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'dashboard', element: <PlaceholderPage title="Savings Dashboard" phase={6} /> },
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
