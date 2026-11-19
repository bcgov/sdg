import { useId, type JSX, type ReactNode } from 'react';

import styles from './section.module.css';

export interface SectionProps {
  /** Rendered as the section's `h2` and its accessible name; also adds the yellow accent bar. */
  title?: string;
  /** Rendered as a paragraph under the title. */
  description?: ReactNode;
  /** Content placed below the title and description. */
  children?: ReactNode;
  className?: string;
}

/** A page section with an optional titled, described heading block above its content. */
export function Section({ title, description, children, className }: Readonly<SectionProps>): JSX.Element {
  const headingId = useId();
  const hasTitle = title !== undefined && title !== '';
  const hasDescription = description !== undefined && description !== null && description !== '';
  const classes = [styles['section'], className].filter(Boolean).join(' ');

  return (
    <section className={classes} {...(hasTitle ? { 'aria-labelledby': headingId } : {})}>
      {(hasTitle || hasDescription) && (
        <div className={styles['header']}>
          {hasTitle && (
            <>
              <span className={styles['bar']} aria-hidden="true" />
              <h2 id={headingId} className={styles['title']}>
                {title}
              </h2>
            </>
          )}
          {hasDescription && <p className={styles['description']}>{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
