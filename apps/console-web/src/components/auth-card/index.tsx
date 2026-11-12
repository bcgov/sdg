import { Heading } from '@repo/design-system/components/heading';
import type { ReactNode } from 'react';

import styles from './auth-card.module.css';

interface AuthCardProps {
  /** The page's `h1`. */
  title: string;
  /** Notices, the body text and the actions, in reading order. */
  children: ReactNode;
}

/**
 * The signed-out pages' layout (/login, /not-authorized): one card centered on the page, with the BC Gov emblem beside
 * the page's `h1`. These pages have no navigation, so there is no skip link.
 */
export function AuthCard({ title, children }: Readonly<AuthCardProps>) {
  return (
    <main id="main-content" className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <img className={styles.emblem} src="/favicon.svg" alt="" width={40} height={40} />
          <Heading level={1}>{title}</Heading>
        </div>
        {children}
      </div>
    </main>
  );
}
