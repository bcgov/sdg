import { Heading } from '@repo/design-system/components/heading';
import { Outlet, useMatches } from '@tanstack/react-router';

import styles from './app-shell.module.css';

const FALLBACK_TITLE = 'SDG Console';

/** The deepest matched route's `staticData.title`, so every signed-in page has a non-empty `h1` (KTD5). */
export function usePageTitle(): string {
  return useMatches({ select: (matches) => matches.at(-1)?.staticData.title ?? FALLBACK_TITLE });
}

/** The signed-in pages' layout: a skip link, the page title as the `h1`, and the page in `main`. */
export function AppShell() {
  const title = usePageTitle();
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        Skip to main content
      </a>
      <header className={styles.header}>
        <Heading level={1}>{title}</Heading>
      </header>
      <main id="main-content" className={styles.main} tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
