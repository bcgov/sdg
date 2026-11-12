import type { HeaderUser } from '@repo/sdg-header';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';

import { loginHref, logout } from '../../auth/api';
import { currentUserQueryKey, useCurrentUser } from '../../auth/use-current-user';

export interface HeaderAuth {
  user?: HeaderUser;
  signInHref?: string;
  signOutFn?: () => void;
}

/** Signing in from the landing or the not-authorized page returns to the landing, never to the refusal. */
const RETURN_HOME_PATHS: ReadonlySet<string> = new Set(['/', '/not-authorized']);

/** Ends the session through console-api and hands the browser to the logout URL it returns. */
export function useSignOut(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void logout(() => queryClient.setQueryData(currentUserQueryKey, null));
  }, [queryClient]);
}

/**
 * Header account state: empty while loading (so the header doesn't flash), a Sign in link when signed out or when
 * the API is unreachable, and the administrator's name with a sign-out function otherwise.
 */
export function useHeaderAuth(): HeaderAuth {
  const location = useLocation();
  const { data: user, isPending, isError, error } = useCurrentUser();
  const signOutFn = useSignOut();

  useEffect(() => {
    if (isError) console.error('console-web: could not load the current user', error);
  }, [isError, error]);

  if (isPending) return {};
  if (user) return { user: { name: user.name, email: user.email }, signOutFn };
  // Signing in is a full-page navigation through console-api to Keycloak.
  return { signInHref: loginHref(RETURN_HOME_PATHS.has(location.pathname) ? '/' : location.href) };
}
