import { Heading } from '@repo/design-system/components/heading';
import { Separator } from '@repo/design-system/components/separator';
import type { ReactNode } from 'react';

import styles from './page-layout.module.css';

interface PageLayoutProps {
  /** The page's h1. */
  title: string;
  children?: ReactNode;
}

/** A page's title and the rule below it, grouped 8px apart, then its content, spaced by the page gap. */
export function PageLayout({ title, children }: Readonly<PageLayoutProps>) {
  return (
    <div className={styles['page']}>
      <div className={styles['header']}>
        <Heading level={1} className={styles['title']}>
          {title}
        </Heading>
        <Separator />
      </div>
      {children}
    </div>
  );
}
