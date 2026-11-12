import { NavLink } from '@repo/design-system/components/nav-link';
import { Tooltip, TooltipTrigger } from '@repo/design-system/components/tooltip';
import { FontAwesomeIcon } from '@repo/design-system/icons';
import { createLink } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import type { NavItem } from './nav-items';
import { useSidebar } from './sidebar-context';

import styles from './sidebar.module.css';

/** The design-system NavLink with client-side navigation and `aria-current="page"` on the current page (KTD8). */
export const SidebarLink = createLink(NavLink);

interface RailTooltipProps {
  readonly label: string;
  /** A bcgov Button or NavLink: TooltipTrigger needs a trigger from the same react-aria copy (KTD1). */
  readonly children: ReactElement;
}

/** Labels an icon-only sidebar control with a tooltip, only while the sidebar is the icon rail (R12, KTD6). */
export function RailTooltip({ label, children }: RailTooltipProps) {
  const { expanded } = useSidebar();
  return (
    <TooltipTrigger isDisabled={expanded}>
      {children}
      <Tooltip placement="right">{label}</Tooltip>
    </TooltipTrigger>
  );
}

function SidebarNavItem({ item }: Readonly<{ item: NavItem }>) {
  return (
    <li>
      <RailTooltip label={item.label}>
        <SidebarLink to={item.to} className={styles.item}>
          <FontAwesomeIcon icon={item.icon} className={styles.icon} />
          <span className={styles.label}>{item.label}</span>
        </SidebarLink>
      </RailTooltip>
    </li>
  );
}

interface SidebarNavProps {
  /** The navigation landmark's name, e.g. "Main". */
  readonly label: string;
  readonly items: readonly NavItem[];
}

/** A labelled navigation landmark listing sidebar destinations (R9, R10, R18). */
export function SidebarNav({ label, items }: SidebarNavProps) {
  return (
    <nav aria-label={label} className={styles.nav}>
      <ul className={styles.list}>
        {items.map((item) => (
          <SidebarNavItem key={item.to} item={item} />
        ))}
      </ul>
    </nav>
  );
}
