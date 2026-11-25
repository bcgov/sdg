import { Link } from '@repo/design-system/components/link';
import { Section } from '@repo/design-system/components/section';
import {
  faMagnifyingGlass,
  faPaperPlane,
  faUserGear,
  FontAwesomeIcon,
  type IconDefinition,
} from '@repo/design-system/icons';

import styles from './account-section.module.css';

interface AccountCard {
  icon: IconDefinition;
  title: string;
  /** Where the title links. */
  href: string;
  description: string;
}

// `#` until the destinations exist.
const CARDS: readonly AccountCard[] = [
  {
    icon: faMagnifyingGlass,
    title: 'Discover Services',
    href: '#',
    description: 'Browse and search for government services',
  },
  {
    icon: faPaperPlane,
    title: 'Apply and track your requests',
    href: '#',
    description: 'Submit applications online and check the status of your requests.',
  },
  {
    icon: faUserGear,
    title: 'Manage your information',
    href: '#',
    description: 'View and update your information in one place.',
  },
];

/** What a BC Services Card Account lets a resident do: three cards, side by side, stacking on narrow screens. */
export function AccountSection() {
  return (
    <Section
      className={styles['band']}
      title="Do more with a BC Services Card Account"
      description="You can use your BC Services Card Account to securely access and manage government services online."
    >
      <ul className={styles['cards']}>
        {CARDS.map(({ icon, title, href, description }) => (
          <li key={title} className={styles['card']}>
            <FontAwesomeIcon icon={icon} className={styles['icon']} aria-hidden="true" />
            <div className={styles['text']}>
              <h3 className={styles['title']}>
                <Link className={styles['link']} href={href}>
                  {title}
                </Link>
              </h3>
              <p className={styles['description']}>{description}</p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
