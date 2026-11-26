import { Tab, TabList, TabPanel, Tabs } from '@repo/design-system/components/tabs';

import { ServicesPagination } from './pagination';

import styles from './services-page.module.css';

/** Placeholder cards stand in for the services until there's a catalogue to list (one page of 12). */
const SERVICE_PLACEHOLDER_COUNT = 12;
/** A short list, so the Bookmarks tab reads differently from All Services until bookmarks exist. */
const BOOKMARK_PLACEHOLDER_COUNT = 3;

interface PlaceholderCardsProps {
  count: number;
  /** Three a row on wide screens, for when the sidebar is collapsed. */
  isWide: boolean;
  testId: string;
}

/** Holds the space for cards; decorative until they exist. */
function PlaceholderCards({ count, isWide, testId }: Readonly<PlaceholderCardsProps>) {
  return (
    <div className={`${styles['cards']} ${isWide ? styles['cardsWide'] : ''}`} data-testid={testId} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles['placeholder']} />
      ))}
    </div>
  );
}

interface ResultsProps {
  isWide: boolean;
}

/** Every service: a page of cards and the pagination under them. */
export function AllServicesResults({ isWide }: Readonly<ResultsProps>) {
  return (
    <div className={styles['results']}>
      <PlaceholderCards count={SERVICE_PLACEHOLDER_COUNT} isWide={isWide} testId="service-placeholders" />
      <ServicesPagination pageCount={3} summary="Showing results 1 - 12 of 36 services" />
    </div>
  );
}

/** The resident's bookmarked services, in the same layout. Placeholders only: bookmarking isn't built yet. */
function BookmarkResults({ isWide }: Readonly<ResultsProps>) {
  return (
    <div className={styles['results']}>
      <PlaceholderCards count={BOOKMARK_PLACEHOLDER_COUNT} isWide={isWide} testId="bookmark-placeholders" />
      <ServicesPagination pageCount={1} summary="Showing results 1 - 3 of 3 bookmarks" />
    </div>
  );
}

/** Signed-in residents switch between All Services and their Bookmarks; the tab row's rule is the page's separator. */
export function ServicesTabs({ isWide }: Readonly<ResultsProps>) {
  return (
    <Tabs>
      <TabList aria-label="Services">
        <Tab id="all">All Services</Tab>
        <Tab id="bookmarks">Bookmarks</Tab>
      </TabList>
      <TabPanel id="all">
        <AllServicesResults isWide={isWide} />
      </TabPanel>
      <TabPanel id="bookmarks">
        <BookmarkResults isWide={isWide} />
      </TabPanel>
    </Tabs>
  );
}
