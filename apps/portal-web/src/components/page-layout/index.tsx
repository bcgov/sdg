import { Heading } from '@repo/design-system/components/heading';
import { Separator } from '@repo/design-system/components/separator';
import type { ReactNode } from 'react';

import styles from './page-layout.module.css';

interface PageLayoutProps {
  /** The page's h1. */
  title: string;
  /** A line under the title, above the rule. */
  subtitle?: string;
  children?: ReactNode;
}

/** A page's title, optional subtitle and the rule below them, grouped 8px apart, then its content, spaced by the page gap. */
export function PageLayout({ title, subtitle, children }: Readonly<PageLayoutProps>) {
  return (
    <div className={styles['page']}>
      <div className={styles['header']}>
        <Heading level={1} className={styles['title']}>
          {title}
        </Heading>
        {subtitle !== undefined && <p className={styles['subtitle']}>{subtitle}</p>}
        <Separator />
      </div>
      {children}
    </div>
  );
}
