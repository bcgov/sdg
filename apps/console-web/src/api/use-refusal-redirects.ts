import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

import { currentUserQueryKey } from '../auth/use-current-user';
import { ApiError } from './http';

/**
 * The app-wide refusal handling, for every query and mutation: a 401 sends the administrator to the sign-in card with a
 * "session ended" message, and core-api's 403 to the not-authorized page. Every other refusal stays with the screen
 * that made the call.
 */
export function useRefusalRedirects(): void {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    const onError = (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      const { pathname, href } = router.state.location;
      if (error.kind === 'session-ended') {
        queryClient.setQueryData(currentUserQueryKey, null);
        // A screen's other calls fail the same way once the first has redirected; keep the first page as returnTo.
        if (pathname !== '/login') void router.navigate({ to: '/login', search: { session: 'ended', returnTo: href } });
      } else if (error.kind === 'not-authorized') {
        void router.navigate({ to: '/not-authorized' });
      }
    };
    const stopQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') onError(event.action.error);
    });
    const stopMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') onError(event.action.error);
    });
    return () => {
      stopQueries();
      stopMutations();
    };
  }, [queryClient, router]);
}
