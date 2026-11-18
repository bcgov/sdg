/** @jsxImportSource react */
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

import { HEADER_EVENTS, type HeaderEventName } from '../contract.js';
import type { SdgLoginEvent, SdgLogoutEvent, SdgSettingsEvent } from '../types.js';
import type { SdgHeaderIntrinsicProps } from './jsx.js';
import { DEFAULT_HEADER_SRC, loadSdgHeader } from './load-script.js';

export interface SdgHeaderProps {
  siteTitle?: string;
  /** The signed-in user's name; leave undefined when signed out or still checking the session. */
  userName?: string;
  loginHref?: string;
  /** Full-width contents instead of the responsive max-width container. */
  fluid?: boolean;
  /** Called on a plain Log In click; call `event.preventDefault()` to handle sign-in instead of following the link. */
  onLogin?: (event: SdgLoginEvent) => void;
  /**
   * Called on a plain Settings click (a link to SDG's `/settings`); on SDG, call `event.preventDefault()` and route
   * there client-side instead of following the link.
   */
  onSettings?: (event: SdgSettingsEvent) => void;
  /** Called on Log Out. Required in practice for signed-in visitors: the header does not sign anyone out itself. */
  onLogout?: (event: SdgLogoutEvent) => void;
  /** The header script's URL. Defaults to the same-origin `/shared-ui/header/v1/sdg-header.js`. */
  src?: string;
  className?: string;
  /** Nav items: the app's own links (`slot="nav"`), with `aria-current="page"` on the current one. */
  children?: ReactNode;
}

// Listeners via addEventListener: React 19's on* props on custom elements are case-sensitive event names (KTD11).
function useHeaderEvent<K extends HeaderEventName>(
  ref: RefObject<HTMLElement | null>,
  type: K,
  handler: ((event: HTMLElementEventMap[K]) => void) | undefined,
): void {
  useEffect(() => {
    const element = ref.current;
    if (element && handler) element.addEventListener(type, handler);
    return () => {
      if (element && handler) element.removeEventListener(type, handler);
    };
  }, [ref, type, handler]);
}

/** Renders the edge-loaded `<sdg-header>` and loads its script when the page has not. Holds no header behavior. */
export function SdgHeader({
  siteTitle,
  userName,
  loginHref,
  fluid = false,
  onLogin,
  onSettings,
  onLogout,
  src = DEFAULT_HEADER_SRC,
  className,
  children,
}: SdgHeaderProps): ReactNode {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    // The loader logs a failure with context; there is nothing else to do, since the page shows no header (R21).
    loadSdgHeader(src).catch(() => undefined);
  }, [src]);

  useHeaderEvent(ref, HEADER_EVENTS.login, onLogin);
  useHeaderEvent(ref, HEADER_EVENTS.settings, onSettings);
  useHeaderEvent(ref, HEADER_EVENTS.logout, onLogout);

  // Typed through jsx.ts, which also declares <sdg-header> in React's JSX. undefined leaves an attribute off.
  const attributes: SdgHeaderIntrinsicProps = {
    className,
    'site-title': siteTitle,
    'user-name': userName,
    'login-href': loginHref,
    // A boolean attribute: present when true, absent (undefined) when false.
    fluid: fluid ? '' : undefined,
  };

  return (
    <sdg-header ref={ref} {...attributes}>
      {children}
    </sdg-header>
  );
}
