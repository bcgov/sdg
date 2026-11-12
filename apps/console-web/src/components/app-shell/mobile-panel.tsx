import { Dialog } from '@repo/design-system/components/dialog';
import { Modal } from '@repo/design-system/components/modal';
import { useLocation } from '@tanstack/react-router';
import { type ReactNode, useCallback, useEffect, useRef } from 'react';

import { Sidebar } from './sidebar';
import { ExpandedSidebar, useSidebar } from './sidebar-context';

import styles from './mobile-panel.module.css';

/** Closes the panel when the location changes, e.g. after picking a destination in it (R13, KTD3). */
function useCloseOnNavigation(close: () => void): void {
  const href = useLocation({ select: (location) => location.href });
  const previous = useRef(href);
  useEffect(() => {
    if (previous.current === href) return;
    previous.current = href;
    close();
  }, [href, close]);
}

interface PanelContentProps {
  readonly onSearch: () => void;
  readonly onClosed: () => void;
  readonly account: ReactNode;
}

/** The shared sidebar, always expanded. It unmounts only once the panel has finished closing, which `onClosed` reports. */
function PanelContent({ onSearch, onClosed, account }: PanelContentProps) {
  useEffect(() => onClosed, [onClosed]);
  return (
    <ExpandedSidebar>
      <Sidebar onSearch={onSearch} account={account} />
    </ExpandedSidebar>
  );
}

interface MobilePanelProps {
  /** Opens the command palette from the panel's Search button. */
  readonly onSearch: () => void;
  /** Called once the panel has closed and left the page (after its exit animation). */
  readonly onClosed: () => void;
  /** The account button, at the bottom of the panel (R11). */
  readonly account: ReactNode;
}

/**
 * The sidebar below 768px (R13): a slide-over panel opened from the top-bar toggle. It is the bcgov Modal and Dialog
 * (KTD3), so it shares a react-aria copy with the NavLinks, Tooltips and account menu inside it. It closes on
 * navigation, Escape, a press outside it, or the toggle.
 */
export function MobilePanel({ onSearch, onClosed, account }: MobilePanelProps) {
  const { mobileOpen, setMobileOpen } = useSidebar();
  const close = useCallback(() => setMobileOpen(false), [setMobileOpen]);
  useCloseOnNavigation(close);
  return (
    <Modal className={styles.panel} isOpen={mobileOpen} onOpenChange={setMobileOpen} isDismissable>
      <Dialog aria-label="Navigation">
        <PanelContent onSearch={onSearch} onClosed={onClosed} account={account} />
      </Dialog>
    </Modal>
  );
}
