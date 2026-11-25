import { Heading } from '@repo/design-system/components/heading';
import type { JSX, ReactNode } from 'react';

import { DevPageNav, type DevNavItem } from '../dev-page-nav';
import { DevPagesMenu } from '../dev-pages-menu';

import styles from './dev-page-layout.module.css';

export interface DevPageLayoutProps {
  title: string;
  description?: string;
  /** The page's `DevSection`s, in order, for the "On this page" nav. Without any, there's no nav column. */
  sections?: readonly DevNavItem[];
  children: ReactNode;
}

const noSections: readonly DevNavItem[] = [];

/** A dev page: a header with the title and the pages menu, then the "On this page" nav beside the sections. */
export function DevPageLayout({
  title,
  description,
  sections = noSections,
  children,
}: Readonly<DevPageLayoutProps>): JSX.Element {
  return (
    <div className={styles['page']}>
      <header className={styles['header']}>
        <div className={styles['intro']}>
          <p className={styles['eyebrow']}>Developer reference</p>
          <Heading level={1}>{title}</Heading>
          {description && <p className={styles['description']}>{description}</p>}
        </div>
        <DevPagesMenu />
      </header>
      <div className={styles['body']} data-has-nav={sections.length > 0 || undefined}>
        {sections.length > 0 && (
          <div className={styles['aside']}>
            <DevPageNav items={sections} />
          </div>
        )}
        <div className={styles['content']}>{children}</div>
      </div>
    </div>
  );
}
