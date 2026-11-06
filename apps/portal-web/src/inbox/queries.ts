import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { isRefetch } from '../background-fetch';
import { fetchInboxPage, fetchUnreadCount, markAllRead, markRead, type InboxItem, type InboxPage } from './api';

export type InboxTab = 'all' | 'unread';

/** Every inbox query sits under `['inbox']`, which the header's change callback invalidates (KTD11). */
export const inboxKeys = {
  all: ['inbox'] as const,
  lists: ['inbox', 'list'] as const,
  list: (tab: InboxTab) => ['inbox', 'list', tab] as const,
  unreadCount: ['inbox', 'unread-count'] as const,
};

export const inboxListOptions = (tab: InboxTab) =>
  infiniteQueryOptions({
    queryKey: inboxKeys.list(tab),
    queryFn: ({ client, queryKey, pageParam, signal }) =>
      fetchInboxPage({ unread: tab === 'unread', cursor: pageParam, background: isRefetch(client, queryKey), signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: InboxPage) => last.nextCursor ?? undefined,
    // The page offers its own retry; a 401 is the session ending, not worth repeating.
    retry: false,
  });

export const unreadCountOptions = queryOptions({
  queryKey: inboxKeys.unreadCount,
  queryFn: ({ client, queryKey, signal }) => fetchUnreadCount(isRefetch(client, queryKey), signal),
  retry: false,
});

const markedRead = (item: InboxItem, readAt: string): InboxItem => (item.readAt === null ? { ...item, readAt } : item);

type ListData = InfiniteData<InboxPage>;

/** An inbox tab's query, as `useInfiniteQuery(inboxListOptions(tab))` returns it. */
export type InboxListQuery = UseInfiniteQueryResult<ListData>;

function updateCachedItems(client: QueryClient, update: (item: InboxItem) => InboxItem): void {
  client.setQueriesData<ListData>({ queryKey: inboxKeys.lists }, (data) =>
    data ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map(update) })) } : data,
  );
}

/** Marks one item read, shows it read in every cached list, then refetches the inbox. */
export function useMarkRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: markRead,
    onSuccess: (updated) => {
      updateCachedItems(client, (item) => (item.id === updated.id ? { ...item, ...updated } : item));
      void client.invalidateQueries({ queryKey: inboxKeys.all });
    },
    onError: (error) => console.error('portal-web: could not mark the notification read', error),
  });
}

/** Marks every unread item read (R20), shows the cached lists read, then refetches the inbox. */
export function useMarkAllRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: markAllRead,
    onSuccess: () => {
      const readAt = new Date().toISOString();
      updateCachedItems(client, (item) => markedRead(item, readAt));
      void client.invalidateQueries({ queryKey: inboxKeys.all });
    },
    onError: (error) => console.error('portal-web: could not mark all notifications read', error),
  });
}

const newestFirst = (a: InboxItem, b: InboxItem) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

/** Pages can overlap when items arrive between page loads; keep each item's first row. */
function dedupe(items: InboxItem[]): InboxItem[] {
  const byId = new Map<string, InboxItem>();
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
  return [...byId.values()];
}

/**
 * The Unread tab's rows for this visit (R15): the server's unread items, plus every row already shown in this visit,
 * kept in place and shown read once the server no longer lists it as unread.
 */
function mergeVisit(shown: InboxItem[], server: InboxItem[]): InboxItem[] {
  const shownIds = new Set(shown.map(({ id }) => id));
  const current = server.filter((item) => item.readAt === null || shownIds.has(item.id));
  const currentIds = new Set(current.map(({ id }) => id));
  const readAt = new Date().toISOString();
  const kept = shown.filter(({ id }) => !currentIds.has(id)).map((item) => markedRead(item, readAt));
  return [...current, ...kept].toSorted(newestFirst);
}

/**
 * The rows a tab shows, de-duplicated across pages. Mount it once per tab visit: the Unread tab remembers what it has
 * shown until it unmounts.
 */
export function useTabItems(tab: InboxTab, data: ListData | undefined): InboxItem[] {
  const server = useMemo(() => dedupe(data?.pages.flatMap((page) => page.items) ?? []), [data]);
  const [visit, setVisit] = useState(() => ({ server, rows: tab === 'unread' ? mergeVisit([], server) : server }));
  if (visit.server === server) return visit.rows;
  // Derived from the previous render's rows, so it updates during render instead of flashing in an effect.
  const next = { server, rows: tab === 'unread' ? mergeVisit(visit.rows, server) : server };
  setVisit(next);
  return next.rows;
}
