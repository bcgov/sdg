import { Button } from '@repo/design-system/components/button';
import { Text } from '@repo/design-system/components/text';
import { useCallback, useMemo } from 'react';

import { isAudience, type FieldValue, type FlagEvent, type FlagEventAction } from '../../api/feature-flags';
import { loadFailureNotice, NoticeAlert } from '../service-clients/notice';
import { AUDIENCE_LABELS, dateTime, onOff, plural } from './labels';
import { useFlagHistory } from './use-feature-flags';

import styles from './feature-flags.module.css';

const ACTION_LABELS: Readonly<Record<FlagEventAction, string>> = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
  override_set: 'Override set',
  override_removed: 'Override removed',
};

/** core-api records changes under the column names. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  description: 'Description',
  enabled: 'Switch',
  rollout_pct: 'Rollout',
  audience: 'Audience',
};

function formatValue(field: string, value: FieldValue): string {
  if (value === null) return 'none';
  if (typeof value === 'boolean') return onOff(value).toLowerCase();
  if (field === 'rollout_pct') return `${value}%`;
  if (field === 'audience' && isAudience(value)) return AUDIENCE_LABELS[value];
  return `“${value}”`;
}

/** "Rollout: 50% → 80%", or a delete's "3 overrides removed". */
function details(event: FlagEvent): string {
  const isOverride = event.action === 'override_set' || event.action === 'override_removed';
  return Object.entries(event.changes)
    .map(([field, change]) => {
      if (typeof change === 'number') return `${plural(change, 'override', 'overrides')} removed`;
      const label = isOverride ? 'Override' : (FIELD_LABELS[field] ?? field);
      const to = formatValue(field, change.to);
      return change.from === null ? `${label}: ${to}` : `${label}: ${formatValue(field, change.from)} → ${to}`;
    })
    .join('; ');
}

/** "Override set for Grace Hopper by Ada Lovelace". */
function summary(event: FlagEvent): string {
  const subject = event.subject ? ` for ${event.subject.name ?? 'someone no longer known'}` : '';
  return `${ACTION_LABELS[event.action]}${subject} by ${event.actor.name}`;
}

function HistoryItem({ event }: Readonly<{ event: FlagEvent }>) {
  const what = details(event);
  return (
    <li>
      <time dateTime={event.createdAt}>{dateTime.format(new Date(event.createdAt))}</time>
      {': '}
      {summary(event)}
      {what && `. ${what}`}
    </li>
  );
}

/** One flag's history, deleted or not, newest first, a page at a time (R19, AE7). */
export function FlagHistory({ flagKey }: Readonly<{ flagKey: string }>) {
  const { data, error, isPending, isError, isFetchNextPageError, refetch, hasNextPage, fetchNextPage } =
    useFlagHistory(flagKey);
  const retry = useCallback(() => void refetch(), [refetch]);
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const events = useMemo(() => data?.pages.flatMap((page) => page.events) ?? [], [data]);
  const notice = isError ? loadFailureNotice(error, 'The history', isFetchNextPageError ? loadMore : retry) : null;

  if (isPending && !isError) return <Text elementType="p">Loading the history…</Text>;
  return (
    <>
      {notice && <NoticeAlert notice={notice} />}
      {data && events.length === 0 && <Text elementType="p">{flagKey} has no history.</Text>}
      {events.length > 0 && (
        <ol className={styles.history} aria-label={`Changes to ${flagKey}, newest first`}>
          {events.map((event) => (
            <HistoryItem key={event.id} event={event} />
          ))}
        </ol>
      )}
      <Text elementType="p" aria-live="polite">
        {events.length > 0 ? `Showing ${plural(events.length, 'change', 'changes')}.` : ''}
      </Text>
      {hasNextPage && (
        <div>
          <Button variant="secondary" onPress={loadMore}>
            Load more history
          </Button>
        </div>
      )}
    </>
  );
}
