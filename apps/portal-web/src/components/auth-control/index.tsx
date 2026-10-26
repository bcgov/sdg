import type { HeaderUser } from '@repo/sdg-header';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';

import { loginHref, logout } from '../../auth/api';
import { currentUserQueryKey, useCurrentUser } from '../../auth/use-current-user';

/** The `<sdg-header>` account inputs. */
export interface HeaderAuth {
  user?: HeaderUser;
  signInHref?: string;
  signOutFn?: () => void;
}

/**
 * Header account state: empty while loading (so the header doesn't flash), a Sign in link when signed out or when
 * the API is unreachable, and the profile with a sign-out function otherwise.
 */
export function useHeaderAuth(): HeaderAuth {
  const queryClient = useQueryClient();
  const href = useLocation({ select: (location) => location.href });
  const { data: user, isPending, isError, error } = useCurrentUser();

  useEffect(() => {
    if (isError) console.error('portal-web: could not load the current user', error);
  }, [isError, error]);

  const signOutFn = useCallback(() => {
    void logout(() => queryClient.setQueryData(currentUserQueryKey, null));
  }, [queryClient]);

  if (isPending) return {};
  if (user) return { user: { name: user.name, email: user.email }, signOutFn };
  // Signing in is a full-page navigation through portal-api to Keycloak.
  return { signInHref: loginHref(href) };
}
