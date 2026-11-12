import { Button } from '@repo/design-system/components/button';
import { Heading } from '@repo/design-system/components/heading';
import { Separator } from '@repo/design-system/components/separator';
import { faAnglesLeft, faAnglesRight, FontAwesomeIcon } from '@repo/design-system/icons';
import { useMatches } from '@tanstack/react-router';

import { SIDEBAR_ID } from './sidebar';
import { useSidebar } from './sidebar-context';

import styles from './top-bar.module.css';

const FALLBACK_TITLE = 'SDG Console';

/** The deepest matched route's `staticData.title`, so every signed-in page has a non-empty `h1` (KTD5). */
export function usePageTitle(): string {
  return useMatches({ select: (matches) => matches.at(-1)?.staticData.title ?? FALLBACK_TITLE });
}

/** The main area's top bar (R6): the sidebar toggle, a separator, and the page title as the page's `h1`. */
export function TopBar() {
  const { expanded, toggleSidebar } = useSidebar();
  const title = usePageTitle();
  return (
    <header className={styles.topBar}>
      <Button
        variant="tertiary"
        size="small"
        isIconButton
        aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-expanded={expanded}
        aria-controls={SIDEBAR_ID}
        onPress={toggleSidebar}
      >
        <FontAwesomeIcon icon={expanded ? faAnglesLeft : faAnglesRight} />
      </Button>
      <span className={styles.separator}>
        <Separator orientation="vertical" size="small" />
      </span>
      <Heading level={1}>{title}</Heading>
    </header>
  );
}
