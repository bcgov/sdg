import { type NavItem, SdgHeader, type SkipLink } from '@repo/sdg-header/react';
import { useLocation, useRouter } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import { useHeaderAuth } from '../auth-control';

const skipLinks: readonly SkipLink[] = [{ label: 'Skip to main content', href: '#main-content' }];

const navLinks: readonly Omit<NavItem, 'current'>[] = [
  { label: 'Home', href: '/' },
  { label: 'Help', href: '/help' },
];

/** The `<sdg-header>` web component wired to the router and the BFF session. */
export function SiteHeader() {
  const router = useRouter();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { user, signInHref, signOutFn } = useHeaderAuth();

  const navItems = useMemo(
    () => navLinks.map(({ label, href }) => ({ label, href, current: href === pathname })),
    [pathname],
  );
  // Nav items and the logo navigate client-side instead of reloading the app.
  const navigateFn = useCallback((href: string) => void router.navigate({ href }), [router]);

  return (
    <SdgHeader
      signInHref={signInHref}
      skipLinks={skipLinks}
      navItems={navItems}
      user={user}
      signOutFn={signOutFn}
      navigateFn={navigateFn}
    />
  );
}
