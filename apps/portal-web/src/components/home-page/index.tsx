import { Heading } from '@repo/design-system/components/heading';
import { Section } from '@repo/design-system/components/section';
import { faChevronRight, FontAwesomeIcon } from '@repo/design-system/icons';
import type { ReactNode } from 'react';

import { Link } from '../link';
import { AccountSection } from './account-section';
import { HomeSearch } from './home-search';

import styles from './home-page.module.css';

const CHEVRON = <FontAwesomeIcon icon={faChevronRight} aria-hidden="true" />;
const PLACEHOLDER_COUNT = 6;

interface HomePageProps {
  children?: ReactNode;
}

export function HomePage({ children }: Readonly<HomePageProps>) {
  return (
    <div className={styles['page']}>
      {children}
      <div className={styles['hero']}>
        <div className={styles['heroInner']}>
          <Heading level={1} className={styles['title']}>
            Access services online
          </Heading>
          <p className={styles['lede']}>Find services, track application statuses and manage your profile</p>
          <HomeSearch />
        </div>
      </div>
      <Section title="Find a service" description="Choose from popular options or browse the full list.">
        {/* Holds the space for popular-service cards; decorative until they exist (R13). */}
        <div className={styles['grid']} aria-hidden="true">
          {Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => (
            <div key={index} className={styles['placeholder']} />
          ))}
        </div>
        <div className={styles['actions']}>
          <Link to="/services" isButton buttonVariant="secondary" iconRight={CHEVRON}>
            View all services
          </Link>
        </div>
      </Section>
      <AccountSection />
      {/* Placeholders for content still to come, like the not-found page's. */}
      <div className={styles['contentPlaceholder']} data-testid="home-placeholder" aria-hidden="true" />
      <div className={styles['contentPlaceholder']} data-testid="home-placeholder" aria-hidden="true" />
    </div>
  );
}
