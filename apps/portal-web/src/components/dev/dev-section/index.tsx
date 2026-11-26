import { Heading } from '@repo/design-system/components/heading';
import type { JSX, ReactNode } from 'react';

import styles from './dev-section.module.css';

export interface DevSectionProps {
  /** The heading's id: the "On this page" nav links to it. */
  id: string;
  title: string;
  /** One plain-text line under the heading. For richer text, start the children with a paragraph instead. */
  description?: string;
  children?: ReactNode;
}

/** One section of a dev page: an anchored h2, an optional description, then its content. */
export function DevSection({ id, title, description, children }: Readonly<DevSectionProps>): JSX.Element {
  return (
    <section className={styles['section']} aria-labelledby={id}>
      <Heading level={2} id={id}>
        {title}
      </Heading>
      {description && <p className={styles['description']}>{description}</p>}
      {children}
    </section>
  );
}
