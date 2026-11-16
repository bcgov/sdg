import { Tab, TabList, TabPanel, Tabs, type TabsProps } from '@repo/design-system/components/tabs';
import { useCallback } from 'react';

import type { FlagDetail } from '../../api/feature-flags';
import { FlagOverview } from './flag-overview';
import { HistoryTable } from './history-table';
import { OverridesPanel } from './overrides-panel';
import { FLAG_TABS, type FlagTab } from './table-search';
import type { DetailActions } from './use-detail-actions';

import styles from './feature-flags.module.css';

interface FlagTabsProps {
  flag: FlagDetail;
  actions: DetailActions;
  tab: FlagTab;
  onShowTab: (tab: FlagTab) => void;
}

type Key = Parameters<NonNullable<TabsProps['onSelectionChange']>>[0];

const TAB_KEYS: ReadonlySet<Key> = new Set(FLAG_TABS);
const isFlagTab = (key: Key): key is FlagTab => TAB_KEYS.has(key);

/** The flag's overview, overrides and history, one tab each; the URL holds the tab shown (KTD10). */
export function FlagTabs({ flag, actions, tab, onShowTab }: Readonly<FlagTabsProps>) {
  const select = useCallback(
    (key: Key) => {
      if (isFlagTab(key)) onShowTab(key);
    },
    [onShowTab],
  );
  const { on, off } = flag.overrideCounts;
  return (
    <Tabs selectedKey={tab} onSelectionChange={select}>
      <TabList aria-label={`${flag.key} sections`}>
        <Tab id="overview">Overview</Tab>
        <Tab id="overrides">
          Overrides <span className={styles.count}>{on + off}</span>
        </Tab>
        <Tab id="history">History</Tab>
      </TabList>
      <TabPanel id="overview">
        <FlagOverview flag={flag} actions={actions} />
      </TabPanel>
      <TabPanel id="overrides">
        <OverridesPanel flag={flag} actions={actions} />
      </TabPanel>
      <TabPanel id="history">
        <HistoryTable flagKey={flag.key} hideCaption />
      </TabPanel>
    </Tabs>
  );
}
