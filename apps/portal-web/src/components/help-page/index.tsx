import { Link as DesignSystemLink } from '@repo/design-system/components/link';
import { Section } from '@repo/design-system/components/section';
import { faChevronRight, FontAwesomeIcon } from '@repo/design-system/icons';
import { useId } from 'react';

import { ContactInformation } from '../contact-information';
import { SERVICE_BC_CONTACTS, SERVICE_BC_HOURS } from '../contact-information/service-bc';
import { Link } from '../link';
import { NewTabLink } from '../new-tab-link';
import { PageLayout } from '../page-layout';
import { HelpTopics } from './help-topics';
import { ServiceTypes } from './service-types';

import styles from './help-page.module.css';

const CHEVRON = <FontAwesomeIcon icon={faChevronRight} aria-hidden="true" />;

/** The page's sections, in order: the "On this page" links jump to them by these ids. */
const CONTENTS = [
  { id: 'account-setup', label: 'BC Services Card Account setup' },
  { id: 'about', label: 'About Single Digital Gateway' },
  { id: 'services-and-platforms', label: 'Services and Platforms' },
  { id: 'data-and-privacy', label: 'Data & Privacy' },
  { id: 'contact-information', label: 'Contact information' },
] as const;

const LEARN_MORE = [
  { label: 'Disclaimer', href: 'https://www2.gov.bc.ca/gov/content/home/disclaimer' },
  { label: 'Privacy', href: 'https://www2.gov.bc.ca/gov/content/home/privacy' },
  { label: 'Accessibility', href: 'https://www2.gov.bc.ca/gov/content/home/accessible-government' },
  { label: 'Copyright', href: 'https://www2.gov.bc.ca/gov/content/home/copyright' },
] as const;

function OnThisPage() {
  const headingId = useId();
  return (
    <nav className={styles['contents']} aria-labelledby={headingId}>
      <p id={headingId} className={styles['contentsTitle']}>
        On this page
      </p>
      <ul className={styles['contentsList']}>
        {CONTENTS.map(({ id, label }) => (
          <li key={id}>
            <DesignSystemLink href={`#${id}`}>{label}</DesignSystemLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Figma: Product Discussions, node 752:5695. */
export function HelpPage() {
  return (
    <PageLayout title="Help">
      <div className={styles['sections']}>
        <div className={styles['intro']}>
          <p>
            Get help with BC Services and your BC Services Card Account: setting up your account, logging in, and
            keeping your information safe. This guide doesn’t cover individual services or websites. For help with a
            service, like MSP or ICBC, contact that service.
          </p>
          <OnThisPage />
        </div>
        <div id="account-setup">
          <Section
            title="BC Services Card Account setup"
            description="Set up your account with the mobile app, or with a username, password and BC Token."
          >
            <HelpTopics />
          </Section>
        </div>
        <div id="about">
          <Section title="About Single Digital Gateway">
            <p>
              BC Services, also called the Single Digital Gateway, brings B.C. government services together in one
              place. You can find services, apply online and track your applications.
            </p>
            <p>
              You log in with your BC Services Card Account. The same login works on many other government websites and
              apps, so you don’t need a different account for each one.
            </p>
          </Section>
        </div>
        <div id="services-and-platforms">
          <Section
            title="Services and Platforms"
            description="Each service listed on BC Services has a tag that says what kind it is."
          >
            <ServiceTypes />
            <div className={styles['actions']}>
              <Link to="/services" isButton buttonVariant="secondary" size="small" iconRight={CHEVRON}>
                Browse all services
              </Link>
            </div>
          </Section>
        </div>
        <div id="data-and-privacy">
          <Section title="Data & Privacy">
            <p>
              The BC Services Card program records when and how you access an online service. This information is used
              to protect your security and is displayed to you in your account history. The name of the service you
              accessed is stored for 180 days. Information about your activity after logging in to an online service is
              not recorded.
            </p>
            <p>
              When you change your personal identity information (like your name or address), some of the services
              you’ve accessed will be notified of the changes.
            </p>
            <div className={styles['learnMore']}>
              <p>Learn more about BC Services:</p>
              <ul>
                {LEARN_MORE.map(({ label, href }) => (
                  <li key={label}>
                    <NewTabLink href={href}>{label}</NewTabLink>
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        </div>
        <div id="contact-information" className={styles['contact']}>
          <ContactInformation description={SERVICE_BC_HOURS} items={SERVICE_BC_CONTACTS} />
        </div>
      </div>
    </PageLayout>
  );
}
