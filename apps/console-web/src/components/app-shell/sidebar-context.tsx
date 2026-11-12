import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/** Where the desktop sidebar's expanded/collapsed choice is kept, so it survives a reload (R12). */
export const SIDEBAR_STORAGE_KEY = 'console.sidebar';

type StoredState = 'expanded' | 'collapsed';

interface SidebarState {
  /** The desktop sidebar is full width (true) or an icon rail (false). */
  readonly expanded: boolean;
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

/** The app shell's sidebar state (KTD6): the shell, the top-bar toggle and the sidebar read it from here. */
export function SidebarProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [expanded, setExpanded] = useState(readExpanded);
  useEffect(() => storeExpanded(expanded), [expanded]);
  const toggleSidebar = useCallback(() => setExpanded((current) => !current), []);
  const value = useMemo(() => ({ expanded, toggleSidebar }), [expanded, toggleSidebar]);
  return <SidebarContext value={value}>{children}</SidebarContext>;
}

export function useSidebar(): SidebarState {
  const state = useContext(SidebarContext);
  if (!state) throw new Error('useSidebar must be used inside SidebarProvider');
  return state;
}
