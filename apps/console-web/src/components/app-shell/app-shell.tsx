import { Outlet, useRouter } from '@tanstack/react-router';
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCurrentUser } from '../../auth/use-current-user';
import { AccountMenu } from './account-menu';
import { CommandPalette } from './command-palette';
import { MobilePanel } from './mobile-panel';
import { Sidebar } from './sidebar';
import { SidebarProvider, useSidebar } from './sidebar-context';
import { SIDEBAR_TOGGLE_ID, TopBar } from './top-bar';

import styles from './app-shell.module.css';

/** Handlers for ⌘/Ctrl + a key, by lower-case key. */
type Shortcuts = Readonly<Record<string, () => void>>;

/**
 * The shell's one `document` keydown listener (KTD7). It is mounted only under `_app`, so the shortcuts do nothing
 * on the sign-in card. ⌘ and Ctrl both count, so the shortcut works whichever modifier the platform uses.
 */
function useShortcuts(shortcuts: Shortcuts): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const handler = shortcuts[event.key.toLowerCase()];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [shortcuts]);
}

/**
 * The palette's open state, owned by the shell so every way of opening it (Search, ⌘K) goes through one place. The
 * palette and the mobile panel never stack (KTD7): they come from different react-aria copies, whose focus containment
 * and hide-outside would fight. Opening the palette from the open panel closes the panel and opens the palette once
 * the panel has gone, from the top-bar toggle, so Escape returns focus there. ⌘B doesn't open the panel over it.
 */
function usePalette() {
  const { isMobile, mobileOpen, setMobileOpen, toggleSidebar } = useSidebar();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const queued = useRef(false);
  const openPalette = useCallback(() => {
    if (!mobileOpen) return setPaletteOpen(true);
    queued.current = true;
    setMobileOpen(false);
  }, [mobileOpen, setMobileOpen]);
  const onPanelClosed = useCallback(() => {
    if (!queued.current) return;
    queued.current = false;
    document.getElementById(SIDEBAR_TOGGLE_ID)?.focus();
    setPaletteOpen(true);
  }, []);
  const toggleUnlessStacking = useCallback(() => {
    if (!(isMobile && paletteOpen)) toggleSidebar();
  }, [isMobile, paletteOpen, toggleSidebar]);
  const shortcuts = useMemo(() => ({ b: toggleUnlessStacking, k: openPalette }), [toggleUnlessStacking, openPalette]);
  useShortcuts(shortcuts);
  return { paletteOpen, setPaletteOpen, openPalette, onPanelClosed };
}

const ACCOUNT_MENU = <AccountMenu />;

function ShellLayout() {
  const { isMobile } = useSidebar();
  const { paletteOpen, setPaletteOpen, openPalette, onPanelClosed } = usePalette();
  const mainRef = useRef<HTMLElement>(null);
  // Focus `main` directly: not every browser (or jsdom) focuses a fragment's target, and the URL keeps no `#main-content`.
  const skipToMain = useCallback((event: MouseEvent) => {
    event.preventDefault();
    mainRef.current?.focus();
  }, []);
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content" onClick={skipToMain}>
        Skip to main content
      </a>
      {isMobile ? (
        <MobilePanel onSearch={openPalette} onClosed={onPanelClosed} account={ACCOUNT_MENU} />
      ) : (
        <Sidebar onSearch={openPalette} account={ACCOUNT_MENU} />
      )}
      <div className={styles.inset}>
        <TopBar />
        <main ref={mainRef} id="main-content" className={styles.main} tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <CommandPalette isOpen={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

/**
 * The signed-in pages' layout (dashboard-01, R6): a skip link, the sidebar (the mobile panel when narrow, R13), and the
 * main area under its top bar.
 */
/**
 * The `_app` guard let a signed-in administrator in; when the current user later turns null (a /api/auth/me refetch
 * answered 401, e.g. on window focus after an idle tab), the session has ended. Pages that make no API calls never
 * see a 401 of their own, so the shell sends them to the sign-in card the way useRefusalRedirects does for one.
 */
function useSessionEndedRedirect(): void {
  const { data: user } = useCurrentUser();
  const router = useRouter();
  useEffect(() => {
    // A 401 from an API call has already been sent to the card by useRefusalRedirects; keep its returnTo.
    const { pathname, href } = router.state.location;
    if (user !== null || pathname === '/login') return;
    void router.navigate({ to: '/login', search: { session: 'ended', returnTo: href } });
  }, [user, router]);
}

export function AppShell() {
  useSessionEndedRedirect();
  return (
    <SidebarProvider>
      <ShellLayout />
    </SidebarProvider>
  );
}
