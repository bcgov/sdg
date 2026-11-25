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

type Size = 'medium' | 'large';

const HEADING_INSETS: Record<Size, string | undefined> = {
  medium: styles['inset-medium'],
  large: styles['inset-large'],
};
const BODY_PADDING: Record<Size, string | undefined> = {
  medium: styles['padding-medium'],
  large: styles['padding-large'],
};
const BODY_GAPS: Record<Size, string | undefined> = { medium: styles['gap-medium'], large: styles['gap-large'] };

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
  const headingClass = [styles['heading'], styles[tone], HEADING_INSETS[headingInset]].join(' ');
  const bodyClass = [styles['body'], BODY_PADDING[spacing], BODY_GAPS[gap]].join(' ');
  return (
    <section className={styles['panel']} aria-labelledby={headingId}>
      <h2 id={headingId} className={headingClass}>
        {title}
      </h2>
      <div className={bodyClass}>
        {description !== undefined && <p className={styles['description']}>{description}</p>}
        {children}
      </div>
    </section>
  );
}
