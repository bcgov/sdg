import {
  faCompass,
  faIdCard,
  faRightToBracket,
  faUnlockKeyhole,
  faUserGear,
  faWallet,
  FontAwesomeIcon,
  type IconDefinition,
} from '@repo/design-system/icons';

import { NewTabLink } from '../new-tab-link';
import bcToken from './bc-token.png';
import bcscAppLogo from './bcsc-app-logo.png';
import { HELP_URLS } from './help-urls';

import styles from './help-topics.module.css';

const HELP = 'https://id.gov.bc.ca/static/help';

interface HelpLink {
  label: string;
  href: string;
  /** Plain text after the link, e.g. "- if you already have a BC Token". */
  note?: string;
}

interface HelpTopic {
  /** A Font Awesome icon, or `app` for the BC Services Card app's logo. */
  icon: IconDefinition | 'app';
  title: string;
  description: string;
  links: readonly HelpLink[];
  /** Shows a BC Token under the links. */
  showToken?: boolean;
}

const TOPICS: readonly HelpTopic[] = [
  {
    icon: 'app',
    title: 'Mobile app',
    description: 'Set up the BC Services Card app on your phone or tablet, and keep it secure.',
    links: [
      { label: 'How to set up the BC Services Card app', href: HELP_URLS.setUpApp },
      {
        label: 'How to set up the app on additional mobile devices using a QR code',
        href: `${HELP}/setup_qrcode.html`,
      },
      {
        label: 'Check if you have a BC Services Card',
        href: `${HELP}/cardhelp.html`,
        note: '- using it is the fastest way to set up the app',
      },
      { label: 'How to verify your email address during app setup', href: `${HELP}/email.html` },
      { label: 'Securing the app', href: `${HELP}/secure_app.html` },
    ],
  },
  {
    icon: faUnlockKeyhole,
    title: 'Username, password and BC Token',
    description: 'Log in from a computer without the app, using a BC Token.',
    links: [
      { label: 'How to get a BC Token', href: HELP_URLS.getToken },
      {
        label: 'How to set up a username and password',
        href: 'https://id.gov.bc.ca/account/token',
        note: '- if you already have a BC Token',
      },
      { label: 'What a BC Token is and when you need one', href: 'https://id.gov.bc.ca/static/token-overview.html' },
    ],
    showToken: true,
  },
  {
    icon: faIdCard,
    title: 'Verifying your identity',
    description: 'Prove who you are by video call or in person, and see which ID you can use.',
    links: [
      { label: 'Why, when and how to verify your identity', href: `${HELP}/verify_why.html` },
      {
        label: 'Audio and video tips when making a video call to verify identity',
        href: `${HELP}/audio_video_tips.html`,
      },
      { label: 'Accepted ID', href: `${HELP}/accepted-id.html` },
      { label: 'Verification Loop', href: `${HELP}/verification-loop.html` },
    ],
  },
  {
    icon: faCompass,
    title: 'Where to find information',
    description: 'Find your information, what is shared with services and where you can log in.',
    links: [
      {
        label: 'Where to find information',
        href: `${HELP}/where.html`,
        note: '- such as health records or booking appointments',
      },
      { label: 'What information is shared from your account to other services', href: `${HELP}/info_shared.html` },
      { label: 'What websites accept BC Services Card Login', href: 'https://id.gov.bc.ca/account/services' },
    ],
  },
  {
    icon: faRightToBracket,
    title: 'Login and how to use',
    description: 'Log in on a phone, tablet or computer, and fix problems with notifications.',
    links: [
      { label: 'How to log in on a phone or tablet - with the app', href: `${HELP}/login_frommobile.html` },
      { label: 'How to log in from a computer - using the app', href: HELP_URLS.logInFromComputer },
      { label: 'How to log in using a username, password and BC Token', href: `${HELP}/login_fromcomputer_upt.html` },
      {
        label: 'What mobile app notifications are, when they’re sent, and troubleshooting',
        href: `${HELP}/notifications.html`,
      },
      { label: 'Supported browsers', href: `${HELP}/supported_browsers.html` },
    ],
  },
  {
    icon: faWallet,
    title: 'Wallet',
    description: 'Add and use digital credentials, including your Digital Services Card.',
    links: [
      { label: 'Digital Services Card', href: `${HELP}/digital_servicecard.html` },
      { label: 'Adding digital credentials', href: `${HELP}/digital_credential.html` },
      { label: 'Using your digital credentials', href: `${HELP}/using_digital_credential.html` },
    ],
  },
  {
    icon: faUserGear,
    title: 'Managing your account',
    description: 'Remove your account from the app, or get help with a lost or stolen device.',
    links: [
      { label: 'Remove your account from the app', href: `${HELP}/reset_manage_app.html` },
      { label: 'Lost or stolen mobile device', href: `${HELP}/lost_device.html` },
    ],
  },
];

function TopicIcon({ icon }: Readonly<{ icon: HelpTopic['icon'] }>) {
  return (
    <span className={styles['badge']} aria-hidden="true">
      {icon === 'app' ? (
        <img className={styles['appLogo']} src={bcscAppLogo} alt="" width={20} height={20} />
      ) : (
        <FontAwesomeIcon icon={icon} className={styles['icon']} />
      )}
    </span>
  );
}

/** Figma: Product Discussions, node 752:5712. Each help topic as a bordered card of links, two to a row. */
export function HelpTopics() {
  return (
    <ul className={styles['topics']}>
      {TOPICS.map(({ icon, title, description, links, showToken }) => (
        <li key={title} className={styles['topic']}>
          <TopicIcon icon={icon} />
          <div className={styles['main']}>
            <h3 className={styles['title']}>{title}</h3>
            <div className={styles['details']}>
              <p className={styles['description']}>{description}</p>
              <ul className={styles['links']}>
                {links.map(({ label, href, note }) => (
                  <li key={label}>
                    <NewTabLink href={href}>{label}</NewTabLink>
                    {note !== undefined && ` ${note}`}
                  </li>
                ))}
              </ul>
              {showToken === true && (
                <figure className={styles['token']}>
                  <img src={bcToken} alt="" width={126} height={57} />
                  <figcaption>A BC Token</figcaption>
                </figure>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
