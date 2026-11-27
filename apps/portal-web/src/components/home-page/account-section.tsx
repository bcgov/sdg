import { Link } from '@repo/design-system/components/link';
import { Section } from '@repo/design-system/components/section';
import {
  faArrowRightToBracket,
  faArrowUpRightFromSquare,
  faMagnifyingGlass,
  faPaperPlane,
  faUserGear,
  FontAwesomeIcon,
  type IconDefinition,
} from '@repo/design-system/icons';

import { loginHref } from '../../auth/api';
import { useCurrentUser } from '../../auth/use-current-user';
import { Link as RouterLink } from '../link';

import styles from './account-section.module.css';

interface AccountCard {
  icon: IconDefinition;
  title: string;
  /** Where the title links for a signed-in resident. */
  to: '/services' | '/services/bookmarks' | '/settings';
  description: string;
}

const CARDS: readonly AccountCard[] = [
  {
    icon: faMagnifyingGlass,
    title: 'Discover Services',
    to: '/services',
    description: 'Browse and search for government services',
  },
  {
    icon: faPaperPlane,
    title: 'Apply and track your requests',
    to: '/services/bookmarks',
    description: 'Submit applications online and check the status of your requests.',
  },
  {
    icon: faUserGear,
    title: 'Manage your information',
    to: '/settings',
    description: 'View and update your information in one place.',
  },
];

/** BC Services Card's page on getting an account set up. */
const ACCOUNT_SETUP_URL = 'https://id.gov.bc.ca/account/setup-instruction';

const LOGIN_ICON = <FontAwesomeIcon icon={faArrowRightToBracket} aria-hidden="true" />;
const EXTERNAL_ICON = <FontAwesomeIcon icon={faArrowUpRightFromSquare} aria-hidden="true" />;

/**
 * What a BC Services Card Account lets a resident do: three cards, side by side, stacking on narrow screens. Their
 * titles link to those pages only for a signed-in resident; otherwise they are plain text. A signed-out visitor gets
 * Log in (a full-page navigation through portal-api, back to the home page) and the account set-up link; neither
 * shows while the session check is pending, so they don't flash for a signed-in user.
 */
export function AccountSection() {
  const { data: user, isPending } = useCurrentUser();
  const signedOut = !isPending && !user;
  return (
    <Section
      className={styles['band']}
      title="Do more with a BC Services Card Account"
      description="You can use your BC Services Card Account to securely access and manage government services online."
    >
      <ul className={styles['cards']}>
        {CARDS.map(({ icon, title, to, description }) => (
          <li key={title} className={styles['card']}>
            <FontAwesomeIcon icon={icon} className={styles['icon']} aria-hidden="true" />
            <div className={styles['text']}>
              <h3 className={styles['title']}>
                {user ? (
                  <RouterLink className={styles['link']} to={to}>
                    {title}
                  </RouterLink>
                ) : (
                  title
                )}
              </h3>
              <p className={styles['description']}>{description}</p>
            </div>
          </li>
        ))}
      </ul>
      {signedOut && (
        <div className={styles['actions']}>
          <Link href={loginHref('/')} isButton buttonVariant="primary" iconLeft={LOGIN_ICON}>
            Log in with BC Services Card Account
          </Link>
          <Link
            href={ACCOUNT_SETUP_URL}
            target="_blank"
            rel="noopener noreferrer"
            ariaLabel="Set up a BC Services Card Account (opens in a new tab)"
            iconRight={EXTERNAL_ICON}
          >
            Set up a BC Services Card Account
          </Link>
        </div>
      )}
    </Section>
  );
}
