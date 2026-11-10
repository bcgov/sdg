import { Button } from '@repo/design-system/components/button';
import { Text } from '@repo/design-system/components/text';
import { useCallback, useMemo } from 'react';

import type { ServiceClientAction, ServiceClientEvent } from '../../api/service-clients';
import { loadFailureNotice, NoticeAlert } from './notice';
import { useRegistryHistory } from './use-registry';

import styles from './registry.module.css';

const ACTION_LABELS: Readonly<Record<ServiceClientAction, string>> = {
  added: 'Added',
  disabled: 'Disabled',
  enabled: 'Enabled',
  removed: 'Removed',
};

const dateTime = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

function HistoryTable({ events }: { events: readonly ServiceClientEvent[] }) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <caption>Every change to the registry, newest first, including clients since removed</caption>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Client ID</th>
            <th scope="col">Change</th>
            <th scope="col">By</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>
                <time dateTime={event.createdAt}>{dateTime.format(new Date(event.createdAt))}</time>
              </td>
              <td>{event.clientId}</td>
              <td>{ACTION_LABELS[event.action]}</td>
              <td>{event.actor.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The registry's history (R17): who changed what and when, a page at a time. */
export function HistoryPanel() {
  const { data, error, isPending, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useRegistryHistory();
  const retry = useCallback(() => void refetch(), [refetch]);
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const events = useMemo(() => data?.pages.flatMap((page) => page.events) ?? [], [data]);
  const notice = isError ? loadFailureNotice(error, 'The history', data ? loadMore : retry) : null;

  if (isPending) return <Text elementType="p">Loading the history…</Text>;
  return (
    <>
      {notice && <NoticeAlert notice={notice} />}
      {data && events.length === 0 && <Text elementType="p">No changes have been made to the registry yet.</Text>}
      {events.length > 0 && <HistoryTable events={events} />}
      <Text elementType="p" aria-live="polite">
        {events.length > 0 ? `Showing ${events.length} ${events.length === 1 ? 'change' : 'changes'}.` : ''}
      </Text>
      {hasNextPage && (
        <Button variant="secondary" isPending={isFetchingNextPage} onPress={loadMore}>
          Load more history
        </Button>
      )}
    </>
  );
}
