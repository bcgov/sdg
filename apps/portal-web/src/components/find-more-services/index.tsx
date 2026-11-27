import { Link } from '@repo/design-system/components/link';
import {
  faArrowUpRightFromSquare,
  faCircleInfo,
  faLandmark,
  faShop,
  FontAwesomeIcon,
  type IconDefinition,
} from '@repo/design-system/icons';

import { SupplementaryBlock } from '../supplementary-block';

import styles from './find-more-services.module.css';

interface ServiceLink {
  label: string;
  href: string;
}

interface OtherService {
  icon: IconDefinition;
  title: string;
  description: string;
  links: readonly ServiceLink[];
}

const EXTERNAL_ICON = <FontAwesomeIcon icon={faArrowUpRightFromSquare} aria-hidden="true" />;

// Every link is a gov.bc.ca page, opened in a new tab.
const SERVICES: readonly OtherService[] = [
  {
    icon: faCircleInfo,
    title: 'Service BC',
    description:
      'Service BC provides front line support for many of the hundreds of programs and services the provincial government offers to residents, businesses and visitors.',
    links: [
      {
        label: 'Learn more about Service BC',
        href: 'https://www2.gov.bc.ca/gov/content/governments/organizational-structure/ministries-organizations/ministries/citizens-services/servicebc',
      },
      { label: 'Book an appointment', href: 'https://appointments.servicebc.gov.bc.ca/appointmentt' },
    ],
  },
  {
    icon: faShop,
    title: 'FrontCounter BC',
    description:
      'Learn about and apply for licences, permits, registrations and other authorizations required to utilize the Province’s natural resources.',
    links: [
      {
        label: 'Learn more about FrontCounter BC',
        href: 'https://www2.gov.bc.ca/gov/content/industry/natural-resource-use/natural-resource-permits/fcbc-locations',
      },
    ],
  },
  {
    icon: faLandmark,
    title: 'Courthouses',
    description:
      'Staffed court registries are open to the public from 9 am to 4 pm Monday to Friday, excluding statutory holidays, Easter Monday and Boxing Day.',
    links: [
      {
        label: 'Find courthouse locations',
        href: 'https://www2.gov.bc.ca/gov/content/justice/courthouse-services/courthouse-locations',
      },
    ],
  },
];

/**
 * "Find more services": other B.C. government services a resident may need, each with its links. The title bar's 24px
 * inset matches the body's padding, so the title, description and services share one left (and right) edge.
 */
export function FindMoreServices() {
  return (
    <SupplementaryBlock
      title="Find more services"
      tone="light"
      spacing="large"
      headingInset="large"
      description="Looking for a service that isn't available here yet? These resources can help you find and access other B.C. government services."
    >
      <ul className={styles['services']}>
        {SERVICES.map(({ icon, title, description, links }) => (
          <li key={title} className={styles['service']}>
            <span className={styles['badge']} aria-hidden="true">
              <FontAwesomeIcon icon={icon} className={styles['icon']} />
            </span>
            <div className={styles['text']}>
              <h3 className={styles['title']}>{title}</h3>
              <p className={styles['description']}>{description}</p>
              <ul className={styles['links']}>
                {links.map(({ label, href }) => (
                  <li key={label} className={styles['link']}>
                    <Link
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      ariaLabel={`${label} (opens in a new tab)`}
                      iconRight={EXTERNAL_ICON}
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
    </SupplementaryBlock>
  );
}
