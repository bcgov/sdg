import type { JSX } from 'react';
import {
  Tab as AriaTab,
  TabList as AriaTabList,
  TabPanel as AriaTabPanel,
  Tabs as AriaTabs,
  type TabListProps as AriaTabListProps,
  type TabPanelProps as AriaTabPanelProps,
  type TabProps as AriaTabProps,
  type TabsProps as AriaTabsProps,
} from 'react-aria-components';

import styles from './tabs.module.css';

// bcgov ships no tabs, so these are react-aria's, styled with the design tokens. A string `className` is added to ours.
type Styled<P> = Omit<P, 'className'> & { className?: string };

export type TabsProps = Styled<AriaTabsProps>;
export type TabListProps<T extends object = object> = Styled<AriaTabListProps<T>>;
export type TabProps = Styled<AriaTabProps>;
export type TabPanelProps = Styled<AriaTabPanelProps>;

const join = (own: string | undefined, extra: string | undefined) => [own, extra].filter(Boolean).join(' ');

/** A set of tabs: a `TabList` of `Tab`s, then one `TabPanel` per tab, matched by `id`. */
export function Tabs({ className, ...props }: Readonly<TabsProps>): JSX.Element {
  return <AriaTabs {...props} className={join(styles['tabs'], className)} />;
}

/** The row of tabs, underlined across its width; needs an `aria-label` naming what the tabs switch between. */
export function TabList<T extends object>({ className, ...props }: Readonly<TabListProps<T>>): JSX.Element {
  return <AriaTabList {...props} className={join(styles['tabList'], className)} />;
}

/** One tab: its label, and the selected one underlined in B.C. blue. */
export function Tab({ className, ...props }: Readonly<TabProps>): JSX.Element {
  return <AriaTab {...props} className={join(styles['tab'], className)} />;
}

/** The selected tab's content; the others aren't rendered. */
export function TabPanel({ className, ...props }: Readonly<TabPanelProps>): JSX.Element {
  return <AriaTabPanel {...props} className={join(styles['tabPanel'], className)} />;
}
