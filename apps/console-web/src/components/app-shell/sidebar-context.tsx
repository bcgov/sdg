import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/** Below 768px the sidebar is the slide-over panel: the same breakpoint as `<sdg-header>`'s collapsed layout. */
export const MOBILE_QUERY = '(max-width: 767.98px)';

/** Where the desktop sidebar's expanded/collapsed choice is kept, so it survives a reload (R12). */
export const SIDEBAR_STORAGE_KEY = 'console.sidebar';

type StoredState = 'expanded' | 'collapsed';

interface SidebarState {
  /** The desktop sidebar is full width (true) or an icon rail (false). */
  readonly expanded: boolean;
  /** The screen is narrower than 768px, so the sidebar is the mobile panel. */
  readonly isMobile: boolean;
  /** The mobile panel is open; always false on a wide screen. */
  readonly mobileOpen: boolean;
  readonly setMobileOpen: (open: boolean) => void;
  /** Switches the desktop sidebar between expanded and the rail, or opens and closes the mobile panel when narrow. */
  readonly toggleSidebar: () => void;
}

const SidebarContext = createContext<SidebarState | null>(null);

/** Starts expanded unless "collapsed" was stored; a blocked store (private mode, policy) counts as nothing stored. */
function readExpanded(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) !== 'collapsed';
  } catch (error) {
    console.warn('console-web: could not read the sidebar state', error);
    return true;
  }
}

function storeExpanded(expanded: boolean): void {
  const value: StoredState = expanded ? 'expanded' : 'collapsed';
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, value);
  } catch (error) {
    console.warn('console-web: could not store the sidebar state', error);
  }
}

/**
 * Whether the screen is below the breakpoint. Crossing it either way closes the mobile panel (`onCross`), so an open
 * panel never lingers over the desktop sidebar or reappears on the next narrowing.
 */
function useIsMobile(onCross: () => void): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const list = window.matchMedia(MOBILE_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
      onCross();
    };
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [onCross]);
  return isMobile;
}

/** The app shell's sidebar state (KTD6): the shell, the top-bar toggle and the sidebar read it from here. */
export function SidebarProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [expanded, setExpanded] = useState(readExpanded);
  useEffect(() => storeExpanded(expanded), [expanded]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const isMobile = useIsMobile(closeMobile);
  // The panel's toggle leaves the stored desktop choice alone.
  const toggleSidebar = useCallback(
    () => (isMobile ? setMobileOpen((open) => !open) : setExpanded((current) => !current)),
    [isMobile],
  );
  const value = useMemo(
    () => ({ expanded, isMobile, mobileOpen, setMobileOpen, toggleSidebar }),
    [expanded, isMobile, mobileOpen, toggleSidebar],
  );
  return <SidebarContext value={value}>{children}</SidebarContext>;
}

/** Shows the sidebar content expanded whatever the desktop choice is: the mobile panel is never the icon rail. */
export function ExpandedSidebar({ children }: Readonly<{ children: ReactNode }>) {
  const state = useSidebar();
  const value = useMemo(() => ({ ...state, expanded: true }), [state]);
  return <SidebarContext value={value}>{children}</SidebarContext>;
}

export function useSidebar(): SidebarState {
  const state = useContext(SidebarContext);
  if (!state) throw new Error('useSidebar must be used inside SidebarProvider');
  return state;
}
