import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { stubViewport } from '../../test-support/match-media';
import { ExpandedSidebar, SIDEBAR_STORAGE_KEY, SidebarProvider, useSidebar } from './sidebar-context';

const renderSidebar = () => renderHook(() => useSidebar(), { wrapper: SidebarProvider });
const ExpandedWrapper = ({ children }: { children: ReactNode }) => (
  <SidebarProvider>
    <ExpandedSidebar>{children}</ExpandedSidebar>
  </SidebarProvider>
);

const blocked = () => {
  throw new DOMException('The operation is insecure.', 'SecurityError');
};

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('sidebar state (R12, KTD6)', () => {
  it('starts expanded when nothing is stored', () => {
    const { result } = renderSidebar();
    expect(result.current.expanded).toBe(true);
  });

  it('starts collapsed when "collapsed" is stored', () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, 'collapsed');
    const { result } = renderSidebar();
    expect(result.current.expanded).toBe(false);
  });

  it('starts expanded when the stored value is not one it wrote', () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, 'sideways');
    const { result } = renderSidebar();
    expect(result.current.expanded).toBe(true);
  });

  it('stores the choice on every toggle', () => {
    const { result } = renderSidebar();
    act(() => result.current.toggleSidebar());
    expect(result.current.expanded).toBe(false);
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('collapsed');
    act(() => result.current.toggleSidebar());
    expect(result.current.expanded).toBe(true);
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('expanded');
  });

  it('starts expanded and still toggles when the store throws on read and write, logging each failure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);

    const { result } = renderSidebar();
    expect(result.current.expanded).toBe(true);
    act(() => result.current.toggleSidebar());
    expect(result.current.expanded).toBe(false);
    expect(warn).toHaveBeenCalledWith('console-web: could not read the sidebar state', expect.any(DOMException));
    expect(warn).toHaveBeenCalledWith('console-web: could not store the sidebar state', expect.any(DOMException));
  });

  it('toggles mobileOpen when narrow and closes it when crossing the breakpoint (lines 53-54, 71)', () => {
    const viewport = stubViewport(true);
    const { result } = renderSidebar();
    expect(result.current.isMobile).toBe(true);
    act(() => result.current.toggleSidebar());
    expect(result.current.mobileOpen).toBe(true);

    viewport.set(false);
    expect(result.current.isMobile).toBe(false);
    expect(result.current.mobileOpen).toBe(false);
  });

  it('forces expanded to true inside ExpandedSidebar (lines 83-85)', () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, 'collapsed');
    const { result } = renderHook(() => useSidebar(), { wrapper: ExpandedWrapper });
    expect(result.current.expanded).toBe(true);
  });

  it('throws when useSidebar is called outside SidebarProvider (line 90)', () => {
    expect(() => renderHook(() => useSidebar())).toThrow('useSidebar must be used inside SidebarProvider');
  });
});
