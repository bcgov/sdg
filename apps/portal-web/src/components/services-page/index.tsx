import { Button } from '@repo/design-system/components/button';
import { Tooltip, TooltipTrigger } from '@repo/design-system/components/tooltip';
import { faFilter, FontAwesomeIcon } from '@repo/design-system/icons';
import { useCallback, useState } from 'react';

import { ServiceSearch } from '../service-search';
import { ServicesPagination } from './pagination';
import { SearchToolsSheet } from './search-tools-sheet';
import { SearchToolsSidebar } from './search-tools-sidebar';
import { StillLooking } from './still-looking';
import { DEFAULT_SERVICE_TYPE, type ServiceType } from './type-filter';
import { useOnEnterWideLayout } from './use-wide-layout';

import styles from './services-page.module.css';

/** Placeholder cards stand in for the services until there's a catalogue to list (one page of 12). */
const PLACEHOLDER_COUNT = 12;

const TOOLS_ICON = <FontAwesomeIcon icon={faFilter} aria-hidden="true" />;

interface ServicesPageProps {
  /** The search the visitor arrived with, shown in the field. */
  query?: string;
}

/**
 * The Services page (Figma: Developer Handoff 26:21014): Search tools beside the page header (a filter button beside the search on narrower screens), a grid of service
 * cards, pagination and a way to get help. The filters and pagination are presentational for now.
 */
export function ServicesPage({ query }: Readonly<ServicesPageProps>) {
  // One Type choice for both the sidebar (wide screens) and the sheet (medium and small), so they always agree.
  const [type, setType] = useState<ServiceType>(DEFAULT_SERVICE_TYPE);
  const [isSidebarExpanded, setSidebarExpanded] = useState(true);
  const [isSheetOpen, setSheetOpen] = useState(false);
  const openSheet = useCallback(() => setSheetOpen(true), []);

  // Growing into the wide layout with the sheet open: the sheet goes and the sidebar shows the same tools, open even
  // if it was collapsed. With the sheet closed, the sidebar stays as the visitor left it.
  useOnEnterWideLayout(
    useCallback(() => {
      if (!isSheetOpen) return;
      setSheetOpen(false);
      setSidebarExpanded(true);
    }, [isSheetOpen]),
  );
  return (
    <div className={styles['layout']}>
      <SearchToolsSidebar
        isExpanded={isSidebarExpanded}
        onExpandedChange={setSidebarExpanded}
        type={type}
        onTypeChange={setType}
      />
      <div className={styles['primary']}>
        <header className={styles['header']}>
          <h1 className={styles['title']}>Services</h1>
          <p className={styles['description']}>Find online application forms, service websites and government apps.</p>
          <ServiceSearch key={query ?? ''} defaultQuery={query}>
            {/* Medium and small screens only: the sidebar's place is taken by the sheet. */}
            <span className={styles['toolsTrigger']}>
              <TooltipTrigger delay={300}>
                <Button variant="secondary" isIconButton aria-label="Search tools" onPress={openSheet}>
                  {TOOLS_ICON}
                </Button>
                <Tooltip placement="top">Search tools</Tooltip>
              </TooltipTrigger>
            </span>
          </ServiceSearch>
        </header>
        {/* Holds the space for the service cards; decorative until they exist. */}
        <div
          className={`${styles['cards']} ${isSidebarExpanded ? '' : styles['cardsWide']}`}
          data-testid="service-placeholders"
          aria-hidden="true"
        >
          {Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => (
            <div key={index} className={styles['placeholder']} />
          ))}
        </div>
        <ServicesPagination />
        <StillLooking />
      </div>
      <SearchToolsSheet isOpen={isSheetOpen} onOpenChange={setSheetOpen} type={type} onTypeChange={setType} />
    </div>
  );
}
