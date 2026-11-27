import { type Query, type QueryCacheNotifyEvent, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

import { ApiError } from '../api/http';
import { loginHref } from './api';
import { announceSessionEnded, openSessionChannel } from './session-channel';
import { currentUserQueryKey } from './use-current-user';

/** The pathless layout whose pages need a session (`routes/_authenticated.tsx`). */
const AUTHENTICATED_ROUTE_ID = '/_authenticated';

const isCurrentUserQuery = (query: Query): boolean => query.queryHash === JSON.stringify(currentUserQueryKey);

/** The error or fetched (not `setQueryData`) result an update event carries, if any. */
function updateOf(event: QueryCacheNotifyEvent): { error: unknown } | { data: unknown } | undefined {
  if (event.type !== 'updated') return undefined;
  if (event.action.type === 'error') return { error: event.action.error };
  if (event.action.type === 'success' && !event.action.manual) return { data: event.action.data };
  return undefined;
}

/** Calls `onError` for every query and mutation error, and `onCurrentUser` for each fetched `/api/auth/me` answer. */
function watchCaches(
  queryClient: QueryClient,
  onError: (error: unknown) => void,
  onCurrentUser: (data: unknown) => void,
): () => void {
  const stopQueries = queryClient.getQueryCache().subscribe((event) => {
    const update = updateOf(event);
    if (!update) return;
    if ('error' in update) onError(update.error);
    else if (isCurrentUserQuery(event.query)) onCurrentUser(update.data);
  });
  const stopMutations = queryClient.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error') onError(event.action.error);
  });
  return () => {
    stopQueries();
    stopMutations();
  };
}

/**
 * The app-wide answer to a session that ends while the resident is on the site: Keycloak refused the BFF's refresh
 * (the 30-minute idle limit passed), or the session ended elsewhere. Either a call answers 401, or a `/api/auth/me`
 * refetch (on window focus) answers signed out after answering a user. The header then shows Log In, and a page that
 * needs a session goes to the BFF login the way the `_authenticated` guard sends a signed-out visitor, returning to the
 * same page. Public pages stay where they are. Log Out sets the user to `null` with `setQueryData`, which is not a
 * fetch, so it keeps its own redirect to Keycloak's logout.
 *
 * Tabs share the news (`session-channel.ts`): a 401 here, or Log Out in any tab (`logout`), tells the others, which
 * end their session the same way.
 */
export function useSessionEndedRedirect(): void {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    let redirected = false;
    let wasSignedIn = Boolean(queryClient.getQueryData(currentUserQueryKey));

    const toLogin = () => {
      const { matches, location } = router.state;
      // A page's other calls fail the same way once the first has redirected.
      if (redirected || !matches.some((match) => match.routeId === AUTHENTICATED_ROUTE_ID)) return;
      redirected = true;
      void router.navigate({ href: loginHref(location.href), reloadDocument: true, replace: true });
    };
    /** `announce`: this tab found out (a 401), so the other tabs should hear; a tab that heard it doesn't echo it. */
    const endSession = (announce: boolean) => {
      if (announce && wasSignedIn) announceSessionEnded();
      wasSignedIn = false;
      queryClient.setQueryData(currentUserQueryKey, null);
      toLogin();
    };
    const onError = (error: unknown) => {
      if (error instanceof ApiError && error.kind === 'session-ended') endSession(true);
    };
    // Only a signed-in user turning signed out means the session ended; a visitor who arrived signed out is the
    // guard's to send.
    const onCurrentUser = (data: unknown) => {
      if (data) wasSignedIn = true;
      else if (data === null && wasSignedIn) {
        wasSignedIn = false;
        toLogin();
      }
    };

    const stopWatching = watchCaches(queryClient, onError, onCurrentUser);
    // Another tab signed out or found the session ended: this tab's cookie went with it.
    const channel = openSessionChannel({ onEnded: () => wasSignedIn && endSession(false) });
    return () => {
      stopWatching();
      channel.close();
    };
  }, [queryClient, router]);
}
