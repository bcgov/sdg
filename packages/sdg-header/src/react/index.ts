// React 19 wrapper for <sdg-header>. React stays out of the core build: the core never imports this entry.
import { createElement, type JSX } from 'react';

import { defineSdgHeader } from '../define.js';
import type { HeaderUser, NavItem, SkipLink } from '../types.js';

export type { HeaderUser, NavItem, SkipLink };

defineSdgHeader();

export interface SdgHeaderProps {
  /** Text after the divider. Defaults to `SDG`; an empty string hides the divider and title. */
  headerTitle?: string;
  /** Where the logo links. Defaults to `/`. */
  logoHref?: string;
  /** The Sign in link, shown when set and there is no user. */
  signInHref?: string;
  /** Accessible name of the `<nav>`. Defaults to `Main`. */
  navLabel?: string;
  /** Accessible name of the hamburger button. Defaults to `Menu`. */
  menuLabel?: string;
  skipLinks?: readonly SkipLink[];
  navItems?: readonly NavItem[];
  /** Leave unset (with no `signInHref`) while the session is loading, so the header doesn't flash. */
  user?: HeaderUser | null;
  /** Signs the user out; Log out is shown only when set. */
  signOutFn?: () => void;
  /** Client-side navigation for plain clicks on nav items and the logo, e.g. your router's navigate. */
  navigateFn?: (href: string) => void;
  id?: string;
  className?: string;
}

// Shared, so an omitted list keeps the same identity across renders and the element doesn't re-render for it.
const none: readonly never[] = Object.freeze([]);

/**
 * `<sdg-header>` for React 19. String props become kebab-case attributes. React 19 sets the other props on the defined
 * element as properties, which is why the functions are `*Fn`: React treats `on*` props on custom elements as events.
 */
export function SdgHeader({
  headerTitle,
  logoHref,
  signInHref,
  navLabel,
  menuLabel,
  skipLinks = none,
  navItems = none,
  user = null,
  ...rest
}: SdgHeaderProps): JSX.Element {
  return createElement('sdg-header', {
    'header-title': headerTitle,
    'logo-href': logoHref,
    'sign-in-href': signInHref,
    'nav-label': navLabel,
    'menu-label': menuLabel,
    skipLinks,
    navItems,
    user,
    ...rest,
  });
}
