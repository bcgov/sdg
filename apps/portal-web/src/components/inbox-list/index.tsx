import { Button } from '@repo/design-system/components/button';
import { InlineAlert } from '@repo/design-system/components/inline-alert';
import { Link } from '@repo/design-system/components/link';
import { Text } from '@repo/design-system/components/text';
import type { UseMutationResult } from '@tanstack/react-query';
import { type RefObject, useCallback, useEffect, useRef } from 'react';

import type { InboxItem } from '../../inbox/api';
import { useTabItems, type InboxListQuery, type InboxTab } from '../../inbox/queries';

import styles from './inbox-list.module.css';

export interface InboxListProps {
  tab: InboxTab;
  query: InboxListQuery;
  markRead: UseMutationResult<InboxItem, Error, string>;
  /** Where focus goes when the control the user pressed goes away and no row follows. */
  focusHeading: () => void;
}

const emptyText: Record<InboxTab, string> = {
  all: 'You have no notifications yet.',
  unread: 'You have no unread notifications.',
};

const received = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

const rowLink = (list: HTMLUListElement | null, index: number) => list?.children[index]?.querySelector('a');

/** Focuses the row waiting for focus once it has rendered. */
function focusPendingRow(list: HTMLUListElement | null, pending: RefObject<number | null>): void {
  if (pending.current === null) return;
  const link = rowLink(list, pending.current);
  if (!link) return;
  link.focus();
  pending.current = null;
}

/**
 * One visit to an inbox tab: its rows, "Mark read" per unread row and "Load more" (R10–R15). Mount it with the tab as
 * its key, so the Unread tab's memory of what it has shown ends with the visit (KTD11).
 */
export function InboxList({ tab, query, markRead, focusHeading }: Readonly<InboxListProps>) {
  const items = useTabItems(tab, query.data);
  const listRef = useRef<HTMLUListElement>(null);
  // After "Load more", the first new row takes focus once it has rendered (checked after every render).
  const pendingFocus = useRef<number | null>(null);
  useEffect(() => focusPendingRow(listRef.current, pendingFocus));

  const { mutate } = markRead;
  const onMarkRead = useCallback(
    (item: InboxItem) =>
      mutate(item.id, {
        // The pressed button goes away with the unread state: move on to the next row, or the heading after the last.
        onSuccess: () => {
          const next = rowLink(listRef.current, items.findIndex(({ id }) => id === item.id) + 1);
          if (next) next.focus();
          else focusHeading();
        },
      }),
    [mutate, items, focusHeading],
  );
  const { fetchNextPage } = query;
  const loadMore = useCallback(async () => {
    const firstNew = items.length;
    const { isError } = await fetchNextPage();
    if (isError) return;
    pendingFocus.current = firstNew;
    focusPendingRow(listRef.current, pendingFocus);
  }, [fetchNextPage, items.length]);

  if (query.data === undefined) return <ListState query={query} />;
  if (items.length === 0) return <Text elementType="p">{emptyText[tab]}</Text>;
  return (
    <>
      {markRead.isError ? <InlineAlert variant="danger" title="We could not mark the notification as read." /> : null}
      <ul ref={listRef} className={styles.list} aria-label="Notifications">
        {items.map((item) => (
          <InboxRow
            key={item.id}
            item={item}
            isPending={markRead.isPending && markRead.variables === item.id}
            onMarkRead={onMarkRead}
          />
        ))}
      </ul>
      <LoadMore query={query} loadMore={loadMore} />
    </>
  );
}

/** Before the tab has data: loading, or the load failure with a retry (R14). */
function ListState({ query }: Readonly<Pick<InboxListProps, 'query'>>) {
  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  if (!query.isError) return <Text elementType="p">Loading notifications…</Text>;
  return (
    <>
      <InlineAlert variant="danger" title="We could not load your notifications." />
      <Button variant="secondary" onPress={retry}>
        Try again
      </Button>
    </>
  );
}

interface LoadMoreProps {
  query: InboxListQuery;
  loadMore: () => Promise<void>;
}

/** "Load more" below the rows; a failed page keeps the rows and offers a retry in its place. */
function LoadMore({ query, loadMore }: Readonly<LoadMoreProps>) {
  const onPress = useCallback(() => void loadMore(), [loadMore]);
  if (query.isFetchNextPageError) {
    return (
      <>
        <InlineAlert variant="danger" title="We could not load more notifications." />
        <Button variant="secondary" onPress={onPress}>
          Try again
        </Button>
      </>
    );
  }
  if (!query.hasNextPage) return null;
  return (
    <Button variant="secondary" isPending={query.isFetchingNextPage} onPress={onPress}>
      Load more
    </Button>
  );
}

interface InboxRowProps {
  item: InboxItem;
  isPending: boolean;
  onMarkRead: (item: InboxItem) => void;
}

/** The title is the row's only link; unread rows carry a dot, bold title and hidden "Unread", not colour alone. */
function InboxRow({ item, isPending, onMarkRead }: Readonly<InboxRowProps>) {
  const unread = item.readAt === null;
  const title = item.title ?? 'Notification';
  const onPress = useCallback(() => onMarkRead(item), [onMarkRead, item]);
  return (
    <li className={unread ? `${styles.row} ${styles.unread}` : styles.row}>
      <span className={styles.marker}>
        {unread ? (
          <>
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.visuallyHidden}>Unread</span>
          </>
        ) : null}
      </span>
      <div className={styles.content}>
        <p className={styles.title}>
          <Link href={`/inbox/${encodeURIComponent(item.notificationId)}`}>{title}</Link>
        </p>
        {item.excerpt ? <p className={styles.excerpt}>{item.excerpt}</p> : null}
        <time className={styles.received} dateTime={item.createdAt}>
          {received.format(new Date(item.createdAt))}
        </time>
      </div>
      {unread ? (
        <Button
          variant="tertiary"
          size="small"
          aria-label={`Mark read: ${title}`}
          isPending={isPending}
          onPress={onPress}
        >
          Mark read
        </Button>
      ) : null}
    </li>
  );
}
