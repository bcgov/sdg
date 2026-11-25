import { Link } from '@repo/design-system/components/link';
import { faArrowUpRightFromSquare, FontAwesomeIcon } from '@repo/design-system/icons';

import { SupplementaryBlock } from '../supplementary-block';

import styles from './services-page.module.css';

const EXTERNAL_ICON = <FontAwesomeIcon icon={faArrowUpRightFromSquare} aria-hidden="true" />;

/** "Still can't find what you're looking for?": Service BC's help, with a way to contact it (`#` until confirmed). */
export function StillLooking() {
  return (
    <SupplementaryBlock
      title="Still can’t find what you’re looking for?"
      tone="light"
      spacing="large"
      gap="medium"
      headingInset="large"
      description="Service BC can guide you through Government of British Columbia programs and services. We can help in over 220 languages and through other accessible options."
    >
      <div className={styles['helpActions']}>
        <Link
          href="#"
          target="_blank"
          rel="noopener noreferrer"
          isButton
          buttonVariant="secondary"
          iconRight={EXTERNAL_ICON}
          ariaLabel="Find ways to contact us (opens in a new tab)"
        >
          Find ways to contact us
        </Link>
      </div>
    </SupplementaryBlock>
  );
}
