import { Link } from '@repo/design-system/components/link';
import { useEffect, useId, useState, type JSX } from 'react';

import styles from './dev-page-nav.module.css';

export interface DevNavItem {
  /** The id of the section heading to jump to. */
  id: string;
  title: string;
}

export interface DevPageNavProps {
  items: readonly DevNavItem[];
}

/**
 * Of the headings above the middle of the viewport, the lowest one is the section being read. Watches every heading and
 * re-picks whenever one crosses that line.
 */
function useCurrentSection(ids: readonly string[]): string | undefined {
  const [current, setCurrent] = useState<string | undefined>(ids[0]);
  // A new array each render; the joined ids only change when the sections do.
  const idList = ids.join(' ');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const headings = idList
      .split(' ')
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return undefined;

    const pick = (): void => {
      const line = window.innerHeight / 2;
      const above = headings.filter((h) => h.getBoundingClientRect().top <= line);
      setCurrent((above.at(-1) ?? headings[0])?.id);
    };
    const observer = new IntersectionObserver(pick, { rootMargin: '0px 0px -50% 0px' });
    for (const heading of headings) observer.observe(heading);
    return () => observer.disconnect();
  }, [idList]);

  return current;
}

/**
 * The page's sections as in-page links, marking the one being read. These are fragment links on the current page, so
 * they use the design-system `Link` directly: the router `Link` would mark every one of them as the current page.
 */
export function DevPageNav({ items }: Readonly<DevPageNavProps>): JSX.Element {
  const current = useCurrentSection(items.map((item) => item.id));
  const headingId = useId();

  return (
    <nav aria-labelledby={headingId}>
      <p id={headingId} className={styles['heading']}>
        On this page
      </p>
      <ul className={styles['list']}>
        {items.map(({ id, title }) => (
          <li key={id} className={styles['item']} data-current={id === current || undefined}>
            <Link href={`#${id}`} aria-current={id === current ? 'location' : undefined}>
              {title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
