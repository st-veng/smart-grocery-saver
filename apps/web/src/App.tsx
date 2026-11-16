import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
import { AppShell } from './components/AppShell';
import { HomePage, NotFoundPage, PlaceholderPage } from './routes/pages';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'compare', element: <PlaceholderPage title="Compare" phase={4} /> },
      { path: 'deals', element: <PlaceholderPage title="Deals & History" phase={5} /> },
      { path: 'dashboard', element: <PlaceholderPage title="Savings Dashboard" phase={6} /> },
      { path: 'settings', element: <PlaceholderPage title="Settings" phase={2} /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export function App() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } }),
  );
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
