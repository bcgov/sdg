import type { JSX, ReactNode } from 'react';

import styles from './details.module.css';

export interface DetailsItem {
  /** Stable key for the row. */
  id: string;
  /** The term, rendered in the row's `dt`. */
  label: ReactNode;
  /** The value, rendered in the row's first `dd`. */
  value: ReactNode;
  /** Optional supplementary content (e.g. a link), rendered in a second `dd` in the third column. */
  extra?: ReactNode;
}

export interface DetailsProps {
  items: readonly DetailsItem[];
  className?: string;
  'aria-label'?: string;
}

/** A description list laid out as label / value / extra columns, stacking into one column on narrow screens. */
export function Details({ items, className, 'aria-label': ariaLabel }: Readonly<DetailsProps>): JSX.Element {
  const classes = [styles['details'], className].filter(Boolean).join(' ');
  return (
    <dl className={classes} aria-label={ariaLabel}>
      {items.map(({ id, label, value, extra }) => (
        <div key={id} className={styles['row']}>
          <dt className={styles['label']}>{label}</dt>
          <dd className={styles['value']}>{value}</dd>
          {extra !== undefined && extra !== null && <dd className={styles['extra']}>{extra}</dd>}
        </div>
      ))}
    </dl>
  );
}
