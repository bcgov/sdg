import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';

import { loginHref, logout } from '../../auth/api';
import { currentUserQueryKey, useCurrentUser } from '../../auth/use-current-user';

/** The `<SdgHeader>` auth props: at most one of `userName` (signed in) and `loginHref` (signed out). */
export interface HeaderAuth {
  userName?: string;
  loginHref?: string;
  onLogout?: () => void;
}

/**
 * Header auth state: neither attribute while the session check is pending (the header shows no control, so Log In
 * doesn't flash), Log In when signed out or when the API is unreachable, and the user's name with Log Out otherwise.
 */
export function useHeaderAuth(): HeaderAuth {
  const queryClient = useQueryClient();
  const href = useLocation({ select: (location) => location.href });
  const { data: user, isPending, isError, error } = useCurrentUser();

  useEffect(() => {
    if (isError) console.error('portal-web: could not load the current user', error);
  }, [isError, error]);

  // The header's sdg-logout event: end the BFF session with its origin-checked POST, then follow its redirect (F3).
  const onLogout = useCallback(() => {
    void logout(() => queryClient.setQueryData(currentUserQueryKey, null));
  }, [queryClient]);

  if (isPending) return {};
  if (user) return { userName: user.name, onLogout };
  // Signing in is a full-page navigation through portal-api to Keycloak.
  return { loginHref: loginHref(href) };
}
