import { Heading } from '@bcgov/design-system-react-components';
import { cloneElement, useId, type HTMLAttributes, type JSX, type ReactElement, type ReactNode } from 'react';

import styles from './card.module.css';

const levels = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 } as const;

/** `centered` only applies to the stacked layout, so it can't be combined with `column`. */
type CardLayoutProps =
  | {
      /** Full width, with the icon on the left and the content stacked to its right. */
      column: true;
      centered?: never;
    }
  | {
      column?: false;
      /** Centre-aligns everything in the stacked layout. */
      centered?: boolean;
    };

export type CardProps = Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'> &
  CardLayoutProps & {
    title: string;
    /** Defaults to `h3`. */
    titleElement?: keyof typeof levels;
    description?: string;
    /** Decorative; hidden from assistive technology. */
    icon?: ReactNode;
    /**
     * A link element without children, e.g. a router link. It wraps the title and makes the whole card clickable.
     * Its className is replaced if it renders the upstream `Link`, which this card restyles anyway.
     */
    linkElement?: ReactElement<{ className?: string; children?: ReactNode }>;
    /** Actions shown at the bottom; they stay clickable on their own when the card has a link. */
    buttons?: ReactNode;
    children?: ReactNode;
  };

/** A bordered container for a titled item, optionally linked. */
export function Card({
  title,
  titleElement = 'h3',
  description,
  icon,
  linkElement,
  buttons,
  column,
  centered,
  className,
  children,
  ...props
}: CardProps): JSX.Element {
  const titleId = useId();
  const layout = column ? styles['column'] : centered && styles['centered'];
  const titleContent = linkElement
    ? cloneElement(linkElement, {
        className: [linkElement.props.className, styles['titleLink']].filter(Boolean).join(' '),
        children: title,
      })
    : title;

  return (
    <article
      {...props}
      className={[styles['card'], layout, className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
    >
      {icon ? (
        <span className={styles['icon']} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className={styles['content']}>
        <Heading level={levels[titleElement]} id={titleId}>
          {titleContent}
        </Heading>
        {description ? <p className={styles['description']}>{description}</p> : null}
        {children ? <div className={styles['body']}>{children}</div> : null}
        {buttons ? <div className={styles['buttons']}>{buttons}</div> : null}
      </div>
    </article>
  );
}
