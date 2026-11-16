import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useCallback } from 'react';
import { RouterProvider as AriaRouterProvider } from 'react-aria-components';

import type { createAppRouter } from './router';

export interface AppProps {
  queryClient: QueryClient;
  router: ReturnType<typeof createAppRouter>;
}

/**
 * react-aria links, such as a DataTable row's `href` (KTD9), follow the app router: a press navigates in the app, and
 * Cmd- or middle-click still opens a new tab.
 */
export function App({ queryClient, router }: Readonly<AppProps>) {
  const navigate = useCallback((href: string) => void router.navigate({ href }), [router]);
  const useHref = useCallback((href: string) => router.history.createHref(href), [router]);
  return (
    <QueryClientProvider client={queryClient}>
      <AriaRouterProvider navigate={navigate} useHref={useHref}>
        <RouterProvider router={router} />
      </AriaRouterProvider>
    </QueryClientProvider>
  );
}
