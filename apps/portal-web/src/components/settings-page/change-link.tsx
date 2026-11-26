import { Link } from '@repo/design-system/components/link';
import { faArrowUpRightFromSquare, FontAwesomeIcon } from '@repo/design-system/icons';

/** BC Services Card's page for changing the personal information on a card. */
const CHANGE_PERSONAL_INFORMATION_URL =
  'https://www2.gov.bc.ca/gov/content/governments/government-id/bc-services-card/your-card/change-personal-information';

interface ChangeLinkProps {
  /** The section anchor on the gov.bc.ca page, e.g. `name`. */
  anchor: string;
  /** The link text, e.g. "Change my address"; the accessible name adds that it opens in a new tab. */
  children: string;
}

const EXTERNAL_ICON = <FontAwesomeIcon icon={faArrowUpRightFromSquare} aria-hidden="true" />;

/** Opens the field's gov.bc.ca page in a new tab, marked external visually and for screen readers (R15). */
export function ChangeLink({ anchor, children }: Readonly<ChangeLinkProps>) {
  return (
    <Link
      href={`${CHANGE_PERSONAL_INFORMATION_URL}#${anchor}`}
      target="_blank"
      rel="noopener noreferrer"
      ariaLabel={`${children} (opens in a new tab)`}
      iconRight={EXTERNAL_ICON}
    >
      {children}
    </Link>
  );
}
