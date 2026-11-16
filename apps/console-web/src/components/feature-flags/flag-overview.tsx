import { Heading } from '@repo/design-system/components/heading';
import { Switch } from '@repo/design-system/components/switch';
import { useSearch } from '@tanstack/react-router';
import { type ReactNode, useCallback, useMemo, useState } from 'react';

import type { Audience, FlagDetail } from '../../api/feature-flags';
import { Link } from '../link';
import { action, details } from './history-format';
import { AUDIENCE_LABELS, dateTime, onOff, people } from './labels';
import { SwitchOffDialog } from './switch-off-dialog';
import { type FlagTab, withTab } from './table-search';
import type { DetailActions } from './use-detail-actions';
import { useFlagHistory } from './use-feature-flags';

import styles from './feature-flags.module.css';

type SaveActions = Pick<DetailActions, 'save' | 'isSaving'>;

/** Who each audience is, as the rollout and audience cards say it. */
const AUDIENCE_PEOPLE: Readonly<Record<Audience, string>> = {
  portal: 'people who sign in to the portal',
  console: 'people who sign in to the console',
  both: 'people who sign in to the portal or the console',
};

const RECENT_CHANGES = 3;

/** A link to another of the flag's tabs, keeping the page where it is. */
function TabLink({ flagKey, tab, children }: Readonly<{ flagKey: string; tab: FlagTab; children: ReactNode }>) {
  const search = useSearch({ from: '/_app/feature-flags/$key' });
  const params = useMemo(() => ({ key: flagKey }), [flagKey]);
  return (
    <Link to="/feature-flags/$key" params={params} search={withTab(search, tab)} resetScroll={false}>
      {children}
    </Link>
  );
}

function Card({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className={styles.card} aria-label={title}>
      <Heading level={3} className={styles.cardLabel}>
        {title}
      </Heading>
      {children}
    </section>
  );
}

/** What the switch means for this flag: off stops it for everyone, overrides included. */
function switchNote({ enabled, overrideCounts: { on, off } }: FlagDetail): string {
  if (enabled) return 'Off stops it for everyone, overrides included';
  return on + off === 0 ? 'No one gets it' : 'No one gets it; overrides wait until it’s on';
}

/** The switch, changed right here: on at once, off once confirmed (R16, R21). */
function SwitchCard({ flag, actions: { save, isSaving } }: Readonly<{ flag: FlagDetail; actions: SaveActions }>) {
  const [isAsking, setAsking] = useState(false);
  const toggle = useCallback((on: boolean) => (on ? save({ enabled: true }) : setAsking(true)), [save]);
  const turnOff = useCallback(() => {
    setAsking(false);
    save({ enabled: false });
  }, [save]);
  const cancel = useCallback(() => setAsking(false), []);
  return (
    <Card title="Switch">
      <div className={styles.valueRow}>
        <p className={styles.cardValue}>{onOff(flag.enabled)}</p>
        <Switch aria-label="On" isSelected={flag.enabled} isDisabled={isSaving} onChange={toggle} />
      </div>
      <p className={styles.cardNote}>{switchNote(flag)}</p>
      <SwitchOffDialog flag={flag} isOpen={isAsking} onConfirm={turnOff} onCancel={cancel} />
    </Card>
  );
}

/** The rollout drawn as a share of a bar; the percentage beside it says the same. */
function RolloutBar({ rolloutPct }: Readonly<{ rolloutPct: number }>) {
  const fill = useMemo(() => ({ width: `${rolloutPct}%` }), [rolloutPct]);
  return (
    <div className={styles.bar} aria-hidden="true">
      <div className={styles.barFill} style={fill} />
    </div>
  );
}

function SettingCards({ flag, actions }: Readonly<{ flag: FlagDetail; actions: SaveActions }>) {
  const { on, off } = flag.overrideCounts;
  return (
    <div className={styles.cards}>
      <SwitchCard flag={flag} actions={actions} />
      <Card title="Rollout">
        <p className={styles.cardValue}>{flag.rolloutPct}%</p>
        <RolloutBar rolloutPct={flag.rolloutPct} />
        <p className={styles.cardNote}>of {AUDIENCE_PEOPLE[flag.audience]}, while the switch is on</p>
      </Card>
      <Card title="Audience">
        <p className={styles.cardValue}>{AUDIENCE_LABELS[flag.audience]}</p>
        <p className={styles.cardNote}>The flag applies to {AUDIENCE_PEOPLE[flag.audience]}</p>
      </Card>
      <Card title="Overrides">
        <p className={styles.cardValue}>
          {on} on · {off} off
        </p>
        <p className={styles.cardNote}>
          <TabLink flagKey={flag.key} tab="overrides">
            Manage overrides
          </TabLink>
        </p>
      </Card>
    </div>
  );
}

/** "2 people are forced on". */
const forced = (count: number, state: string) => `${people(count)} ${count === 1 ? 'is' : 'are'} forced ${state}`;

/** "2 people are forced on; 1 person is forced off." */
function overridesRule({ on, off }: FlagDetail['overrideCounts']): string {
  if (on + off === 0) return 'no one has one.';
  const parts = [...(on > 0 ? [forced(on, 'on')] : []), ...(off > 0 ? [forced(off, 'off')] : [])];
  return `${parts.join('; ')}.`;
}

/** The order core-api decides in: the switch, then an override, then the rollout (R21). */
function HowItIsDecided({ flag }: Readonly<{ flag: FlagDetail }>) {
  return (
    <section className={`${styles.panel} ${styles.decision}`} aria-labelledby="how-heading">
      <Heading level={3} id="how-heading" className={styles.panelTitle}>
        How a person gets {flag.key}
      </Heading>
      <ol>
        <li>
          <strong>The switch</strong> is{' '}
          {flag.enabled
            ? 'on, so overrides and then the rollout decide.'
            : 'off, so no one gets it, overrides included.'}
        </li>
        <li>
          <strong>Overrides</strong> {flag.enabled ? 'come next' : 'apply once the switch is on'}:{' '}
          {overridesRule(flag.overrideCounts)}
        </li>
        <li>
          <strong>The rollout</strong>{' '}
          {flag.enabled
            ? `gives it to ${flag.rolloutPct}% of ${AUDIENCE_PEOPLE[flag.audience]}.`
            : `of ${flag.rolloutPct}% counts only while the switch is on.`}
        </li>
      </ol>
    </section>
  );
}

function RecentRows({ flagKey }: Readonly<{ flagKey: string }>) {
  const { data, isPending, isError } = useFlagHistory({ key: flagKey, limit: RECENT_CHANGES });
  if (isError) return <p>The history couldn’t be loaded. Try again in a moment.</p>;
  if (isPending) return <p>Loading the history…</p>;
  if (data.items.length === 0) return <p>{flagKey} has no history.</p>;
  return (
    <table className={styles.miniTable} aria-labelledby="recent-heading">
      <thead>
        <tr>
          <th scope="col">When</th>
          <th scope="col">Admin</th>
          <th scope="col">Action</th>
          <th scope="col">Change</th>
        </tr>
      </thead>
      <tbody>
        {data.items.map((event) => (
          <tr key={event.id}>
            <td>
              <time dateTime={event.createdAt}>{dateTime.format(new Date(event.createdAt))}</time>
            </td>
            <td>{event.actor.name}</td>
            <td>{action(event)}</td>
            <td>{details(event)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RecentChanges({ flagKey }: Readonly<{ flagKey: string }>) {
  return (
    <section className={`${styles.panel} ${styles.recent}`} aria-labelledby="recent-heading">
      <div className={styles.panelHeader}>
        <Heading level={3} id="recent-heading" className={styles.panelTitle}>
          Recent changes
        </Heading>
        <TabLink flagKey={flagKey} tab="history">
          All history
        </TabLink>
      </div>
      <RecentRows flagKey={flagKey} />
    </section>
  );
}

/** The flag at a glance: its settings, the switch to flip, how a person gets it and its last few changes. */
export function FlagOverview({ flag, actions }: Readonly<{ flag: FlagDetail; actions: SaveActions }>) {
  return (
    <div className={styles.overview}>
      <SettingCards flag={flag} actions={actions} />
      <div className={styles.overviewRow}>
        <HowItIsDecided flag={flag} />
        <RecentChanges flagKey={flag.key} />
      </div>
    </div>
  );
}
