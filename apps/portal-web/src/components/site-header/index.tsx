import { type NavItem, SdgHeader, type SkipLink } from '@repo/sdg-header/react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useRouter } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import { currentUserQueryKey } from '../../auth/use-current-user';
import { NOTIFICATIONS_PATH } from '../../inbox/api';
import { inboxKeys } from '../../inbox/queries';
import { useHeaderAuth } from '../auth-control';

const skipLinks: readonly SkipLink[] = [{ label: 'Skip to main content', href: '#main-content' }];

const navLinks: readonly Omit<NavItem, 'current'>[] = [
  { label: 'Home', href: '/' },
  { label: 'Help', href: '/help' },
];

/** The `<sdg-header>` web component wired to the router, the BFF session and portal-api's notifications relay. */
export function SiteHeader() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { user, signInHref, signOutFn } = useHeaderAuth();

  const navItems = useMemo(
    () => navLinks.map(({ label, href }) => ({ label, href, current: href === pathname })),
    [pathname],
  );
  // Nav items and the logo navigate client-side instead of reloading the app.
  const navigateFn = useCallback((href: string) => void router.navigate({ href }), [router]);
  // The header holds the live connection: an open inbox page refetches when it reports a change, and a 401 it hit
  // refreshes the signed-in user, so the header and the page see the session end (R33).
  const notificationsChangedFn = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: inboxKeys.all });
    void queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
  }, [queryClient]);

  return (
    <SdgHeader
      signInHref={signInHref}
      skipLinks={skipLinks}
      navItems={navItems}
      user={user}
      signOutFn={signOutFn}
      navigateFn={navigateFn}
      notificationsUrl={NOTIFICATIONS_PATH}
      inboxHref="/inbox"
      notificationsChangedFn={notificationsChangedFn}
    />
  );
}
