import { Outlet } from '@tanstack/react-router';
import { type MouseEvent, useCallback, useEffect, useMemo, useRef } from 'react';

import { Sidebar } from './sidebar';
import { SidebarProvider, useSidebar } from './sidebar-context';
import { TopBar } from './top-bar';

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

function ShellLayout() {
  const { toggleSidebar } = useSidebar();
  const shortcuts = useMemo(() => ({ b: toggleSidebar }), [toggleSidebar]);
  useShortcuts(shortcuts);
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
      <Sidebar />
      <div className={styles.inset}>
        <TopBar />
        <main ref={mainRef} id="main-content" className={styles.main} tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** The signed-in pages' layout (dashboard-01, R6): a skip link, the sidebar, and the main area under its top bar. */
export function AppShell() {
  return (
    <SidebarProvider>
      <ShellLayout />
    </SidebarProvider>
  );
}
