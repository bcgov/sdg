import { Button } from '@repo/design-system/components/button';
import { faAngleLeft, faAngleRight, FontAwesomeIcon } from '@repo/design-system/icons';

import styles from './services-page.module.css';

const PREVIOUS_ICON = <FontAwesomeIcon icon={faAngleLeft} aria-hidden="true" />;
const NEXT_ICON = <FontAwesomeIcon icon={faAngleRight} aria-hidden="true" />;

interface ServicesPaginationProps {
  /** How many page buttons to show; page 1 is always the current one. */
  pageCount: number;
  /** The results count beside the controls. */
  summary: string;
}

/** Previous, the page numbers, Next and the results count. Presentational for now: page 1 is current, nothing pages. */
export function ServicesPagination({ pageCount, summary }: Readonly<ServicesPaginationProps>) {
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  return (
    <nav className={styles['pagination']} aria-label="Pagination">
      <div className={styles['pages']}>
        <Button variant="tertiary" isIconButton isDisabled aria-label="Previous page">
          {PREVIOUS_ICON}
        </Button>
        {pages.map((page) => (
          <Button
            key={page}
            variant="tertiary"
            aria-label={`Page ${page}`}
            aria-current={page === 1 ? 'page' : undefined}
          >
            {page}
          </Button>
        ))}
        <Button variant="tertiary" isIconButton isDisabled={pageCount <= 1} aria-label="Next page">
          {NEXT_ICON}
        </Button>
      </div>
      <p className={styles['count']}>{summary}</p>
    </nav>
  );
}
