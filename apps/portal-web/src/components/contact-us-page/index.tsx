import { Section } from '@repo/design-system/components/section';

import { ContactInformation } from '../contact-information';
import { SERVICE_BC_CONTACTS, SERVICE_BC_HOURS } from '../contact-information/service-bc';
import { HELP_URLS } from '../help-page/help-urls';
import { NewTabLink } from '../new-tab-link';
import { PageLayout } from '../page-layout';

import styles from './contact-us-page.module.css';

const HELP_DESK_TOPICS = [
  'Set up the BC Services Card app',
  'Set up your username and password',
  'Get a BC Token',
  'Log in to a website',
] as const;

const SUPPORT_GUIDES = [
  { label: 'How to set up the BC Services Card app', href: HELP_URLS.setUpApp },
  { label: 'How to log in from a computer', href: HELP_URLS.logInFromComputer },
  { label: 'How to get a BC Token', href: HELP_URLS.getToken },
] as const;

const HAVE_READY = [
  'The date and time you saw the error',
  'Your BC Services Card serial number. It’s on the back edge of your card, under the bar code.',
  'What happened, including any error message',
] as const;

/** Figma: Product Discussions, node 756:16822. */
export function ContactUsPage() {
  return (
    <PageLayout title="Contact us">
      <div className={styles['sections']}>
        <div className={styles['intro']}>
          <p>Contact the Service BC Help Desk if you have feedback or if you need help to:</p>
          <ul className={styles['bullets']}>
            {HELP_DESK_TOPICS.map((topic) => (
              <li key={topic}>{topic}</li>
            ))}
          </ul>
        </div>
        <Section title="Before you call">
          <ol className={styles['steps']}>
            <li className={styles['step']}>
              <span className={styles['number']} aria-hidden="true">
                1
              </span>
              <div className={styles['stepBody']}>
                <h3 className={styles['stepTitle']}>Check the support guide</h3>
                <ul className={styles['entries']}>
                  {SUPPORT_GUIDES.map(({ label, href }) => (
                    <li key={label} className={styles['entry']}>
                      <NewTabLink href={href}>{label}</NewTabLink>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
            <li className={styles['step']}>
              <span className={styles['number']} aria-hidden="true">
                2
              </span>
              <div className={styles['stepBody']}>
                <h3 className={styles['stepTitle']}>Have these ready, if you can</h3>
                <ul className={styles['entries']}>
                  {HAVE_READY.map((item) => (
                    <li key={item} className={styles['entry']}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          </ol>
        </Section>
        <ContactInformation description={SERVICE_BC_HOURS} items={SERVICE_BC_CONTACTS} />
      </div>
    </PageLayout>
  );
}
