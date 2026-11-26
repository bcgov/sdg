import { Button } from '@repo/design-system/components/button';
import { faAngleLeft, faAngleRight, FontAwesomeIcon } from '@repo/design-system/icons';

import styles from './services-page.module.css';

const PREVIOUS_ICON = <FontAwesomeIcon icon={faAngleLeft} aria-hidden="true" />;
const NEXT_ICON = <FontAwesomeIcon icon={faAngleRight} aria-hidden="true" />;
const PAGES = [1, 2, 3] as const;

/** Previous, the page numbers, Next and the results count. Presentational for now: page 1 of 3, nothing pages. */
export function ServicesPagination() {
  return (
    <nav className={styles['pagination']} aria-label="Pagination">
      <div className={styles['pages']}>
        <Button variant="tertiary" isIconButton isDisabled aria-label="Previous page">
          {PREVIOUS_ICON}
        </Button>
        {PAGES.map((page) => (
          <Button
            key={page}
            variant="tertiary"
            aria-label={`Page ${page}`}
            aria-current={page === 1 ? 'page' : undefined}
          >
            {page}
          </Button>
        ))}
        <Button variant="tertiary" isIconButton aria-label="Next page">
          {NEXT_ICON}
        </Button>
      </div>
      <p className={styles['count']}>Showing results 1 - 12 of 36 services</p>
    </nav>
  );
}
