import { Button } from '@repo/design-system/components/button';
import { Tooltip, TooltipTrigger } from '@repo/design-system/components/tooltip';
import { faFilter, FontAwesomeIcon } from '@repo/design-system/icons';
import { useCallback, useState } from 'react';

import { useCurrentUser } from '../../auth/use-current-user';
import { ServiceSearch } from '../service-search';
import { AllServicesResults, ServicesTabs } from './results';
import { SearchToolsSheet } from './search-tools-sheet';
import { SearchToolsSidebar } from './search-tools-sidebar';
import { StillLooking } from './still-looking';
import { DEFAULT_SERVICE_TYPE, type ServiceType } from './type-filter';
import { useOnEnterWideLayout } from './use-wide-layout';

import styles from './services-page.module.css';

const TOOLS_ICON = <FontAwesomeIcon icon={faFilter} aria-hidden="true" />;

interface ServicesPageProps {
  /** The search the visitor arrived with, shown in the field. */
  query?: string;
}

/**
 * The Services page (Figma: Developer Handoff 26:21014): Search tools beside the page header (a filter button beside the search on narrower screens), a grid of service
 * cards, pagination and a way to get help. A signed-in resident also gets All Services and Bookmarks tabs above the
 * cards. The filters, pagination and bookmarks are presentational for now.
 */
export function ServicesPage({ query }: Readonly<ServicesPageProps>) {
  // One Type choice for both the sidebar (wide screens) and the sheet (medium and small), so they always agree.
  const [type, setType] = useState<ServiceType>(DEFAULT_SERVICE_TYPE);
  const [isSidebarExpanded, setSidebarExpanded] = useState(true);
  const [isSheetOpen, setSheetOpen] = useState(false);
  const openSheet = useCallback(() => setSheetOpen(true), []);
  const { data: user } = useCurrentUser();
  const isSignedIn = Boolean(user);
  const isWide = !isSidebarExpanded;

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
        {/* Signed in, the tab row's rule takes the place of the header's. */}
        <header className={`${styles['header']} ${isSignedIn ? styles['headerAboveTabs'] : ''}`}>
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
        {isSignedIn ? <ServicesTabs isWide={isWide} /> : <AllServicesResults isWide={isWide} />}
        <StillLooking />
      </div>
      <SearchToolsSheet isOpen={isSheetOpen} onOpenChange={setSheetOpen} type={type} onTypeChange={setType} />
    </div>
  );
}
