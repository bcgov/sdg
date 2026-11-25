import { useId, type ReactNode } from 'react';

import styles from './supplementary-block.module.css';

interface SupplementaryBlockProps {
  title: string;
  /** `dark`: white on blue (Contact information); `light`: dark on light blue (Find more services). */
  tone: 'dark' | 'light';
  /** The body's padding and the gap between its blocks: 16px (`medium`) or 24px (`large`). */
  spacing: 'medium' | 'large';
  /** Overrides the gap between the body's blocks, e.g. 24px padding with a 16px gap. */
  gap?: 'medium' | 'large';
  /** The title bar's inset: 4px × 16px (`medium`, the default) or 8px × 24px (`large`). */
  headingInset?: 'medium' | 'large';
  /** A paragraph above the content. */
  description?: string;
  children: ReactNode;
}

/** The Figma supplementary block: a bordered, shadowed panel with a title bar over a white body. */
export function SupplementaryBlock({
  title,
  tone,
  spacing,
  gap = spacing,
  headingInset = 'medium',
  description,
  children,
}: Readonly<SupplementaryBlockProps>) {
  const headingId = useId();
  return (
    <section className={styles['panel']} aria-labelledby={headingId}>
      <h2 id={headingId} className={`${styles['heading']} ${styles[tone]} ${styles[`inset-${headingInset}`]}`}>
        {title}
      </h2>
      <div className={`${styles['body']} ${styles[`padding-${spacing}`]} ${styles[`gap-${gap}`]}`}>
        {description !== undefined && <p className={styles['description']}>{description}</p>}
        {children}
      </div>
    </section>
  );
}
