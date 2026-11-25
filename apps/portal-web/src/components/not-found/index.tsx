import { ContactInformation } from '../contact-information';
import { SERVICE_BC_CONTACTS, SERVICE_BC_HOURS } from '../contact-information/service-bc';
import { Link } from '../link';
import { PageLayout } from '../page-layout';
import lostIllustration from './404-not-found.svg';

import styles from './not-found.module.css';

export function NotFound() {
  return (
    <PageLayout title="Oops, looks like we’re lost" subtitle="Error 404 - Page not found">
      <img className={styles['illustration']} src={lostIllustration} alt="" width={404} height={320} />
      <div className={styles['body']}>
        <p className={styles['lead']}>
          The page you’re looking for might have been removed, moved, or is temporarily unavailable.
        </p>
        <p>We suggest:</p>
        <ul>
          <li>Checking that the web URL has been entered correctly</li>
          <li>
            Going to our{' '}
            <Link className={styles['link']} to="/">
              Home Page
            </Link>{' '}
            and browse through our topics for the information you want
          </li>
          <li>
            Looking for{' '}
            <Link className={styles['link']} to="/services">
              Services
            </Link>{' '}
            or{' '}
            <Link className={styles['link']} to="/help">
              Help
            </Link>
          </li>
        </ul>
      </div>
      <ContactInformation description={SERVICE_BC_HOURS} items={SERVICE_BC_CONTACTS} />
    </PageLayout>
  );
}
