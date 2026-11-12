import { Button } from '@repo/design-system/components/button';
import { Heading } from '@repo/design-system/components/heading';
import { Separator } from '@repo/design-system/components/separator';
import { faAnglesLeft, faAnglesRight, faBars, FontAwesomeIcon, type IconDefinition } from '@repo/design-system/icons';
import { useMatches } from '@tanstack/react-router';

import { SIDEBAR_ID } from './sidebar';
import { useSidebar } from './sidebar-context';

import styles from './top-bar.module.css';

const FALLBACK_TITLE = 'SDG Console';

/** The top-bar toggle's id: the shell moves focus to it before opening the palette from the mobile panel (KTD7). */
export const SIDEBAR_TOGGLE_ID = 'sidebar-toggle';

/** The deepest matched route's `staticData.title`, so every signed-in page has a non-empty `h1` (KTD5). */
function usePageTitle(): string {
  return useMatches({ select: (matches) => matches.at(-1)?.staticData.title ?? FALLBACK_TITLE });
}

interface ToggleLook {
  readonly label: string;
  readonly icon: IconDefinition;
  readonly open: boolean;
  /** The sidebar's id while it is in the page; the closed mobile panel is not. */
  readonly controls: string | undefined;
}

/** Narrow, the toggle opens the mobile panel (R13); wide, it switches the sidebar and the icon rail (R12). */
function useToggleLook(): ToggleLook {
  const { expanded, isMobile, mobileOpen } = useSidebar();
  if (isMobile) {
    return { label: 'Open navigation', icon: faBars, open: mobileOpen, controls: mobileOpen ? SIDEBAR_ID : undefined };
  }
  return expanded
    ? { label: 'Collapse sidebar', icon: faAnglesLeft, open: true, controls: SIDEBAR_ID }
    : { label: 'Expand sidebar', icon: faAnglesRight, open: false, controls: SIDEBAR_ID };
}

/** The main area's top bar (R6): the sidebar toggle, a separator, and the page title as the page's `h1`. */
export function TopBar() {
  const { toggleSidebar } = useSidebar();
  const { label, icon, open, controls } = useToggleLook();
  const title = usePageTitle();
  return (
    <header className={styles.topBar}>
      <Button
        id={SIDEBAR_TOGGLE_ID}
        variant="tertiary"
        size="small"
        isIconButton
        aria-label={label}
        aria-expanded={open}
        aria-controls={controls}
        onPress={toggleSidebar}
      >
        <FontAwesomeIcon icon={icon} />
      </Button>
      <span className={styles.separator}>
        <Separator orientation="vertical" size="small" />
      </span>
      <Heading level={1}>{title}</Heading>
    </header>
  );
}
