import { Button } from '@repo/design-system/components/button';
import { faMagnifyingGlass, FontAwesomeIcon } from '@repo/design-system/icons';
import type { ReactNode } from 'react';

import { MAIN_NAV, SECONDARY_NAV } from './nav-items';
import { useSidebar } from './sidebar-context';
import { RailTooltip, SidebarLink, SidebarNav } from './sidebar-nav';

import styles from './sidebar.module.css';

/** The sidebar element's id, which the top-bar toggle names in `aria-controls`. */
export const SIDEBAR_ID = 'app-sidebar';

/** The command palette's shortcut as the platform writes it (R8). */
const SEARCH_HINT = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K';

/** The emblem and "SDG", linking to the Dashboard (R7); collapsed, only the emblem shows. */
function SidebarBrand() {
  return (
    <SidebarLink to="/" className={styles.brand}>
      <img className={styles.emblem} src="/favicon.svg" alt="" width={32} height={32} />
      <span className={styles.label}>SDG</span>
    </SidebarLink>
  );
}

function SearchButton({ onPress }: Readonly<{ onPress: (() => void) | undefined }>) {
  const { expanded } = useSidebar();
  return (
    <div className={styles.search}>
      <RailTooltip label="Search">
        <Button variant="tertiary" onPress={onPress}>
          <FontAwesomeIcon icon={faMagnifyingGlass} className={styles.icon} />
          <span className={styles.label}>Search</span>
          {expanded ? (
            <kbd className={styles.hint} aria-hidden="true">
              {SEARCH_HINT}
            </kbd>
          ) : null}
        </Button>
      </RailTooltip>
    </div>
  );
}

interface SidebarProps {
  /** Opens the command palette from the Search button. */
  readonly onSearch?: () => void;
  /** The account button, at the very bottom of the sidebar (R11). */
  readonly account?: ReactNode;
}

/**
 * The desktop sidebar (R6–R10, R12): brand, Search, Main nav, then Secondary nav and the account button at the
 * bottom. Expanded or collapsed to an icon rail is `data-state`, which the CSS module styles (KTD6).
 */
export function Sidebar({ onSearch, account }: SidebarProps) {
  const { expanded } = useSidebar();
  return (
    <div id={SIDEBAR_ID} className={styles.sidebar} data-state={expanded ? 'expanded' : 'collapsed'}>
      <SidebarBrand />
      <SearchButton onPress={onSearch} />
      <SidebarNav label="Main" items={MAIN_NAV} />
      <div className={styles.bottom}>
        <SidebarNav label="Secondary" items={SECONDARY_NAV} />
        {account}
      </div>
    </div>
  );
}
