import { Button } from '@repo/design-system/components/button';
import { Heading } from '@repo/design-system/components/heading';
import { InlineAlert } from '@repo/design-system/components/inline-alert';
import { Link as DesignSystemLink } from '@repo/design-system/components/link';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useLocation } from '@tanstack/react-router';
import { useCallback } from 'react';

import { loginHref } from '../../auth/api';
import { requireUser } from '../../auth/require-user';
import { InboxList } from '../../components/inbox-list';
import { isSessionEnded } from '../../inbox/api';
import { inboxListOptions, unreadCountOptions, useMarkAllRead, useMarkRead, type InboxTab } from '../../inbox/queries';

import styles from '../../inbox/inbox.module.css';

interface InboxSearch {
  tab?: 'unread';
}

const HEADING_ID = 'inbox-heading';

const allTab: InboxSearch = {};
const unreadTab: InboxSearch = { tab: 'unread' };
// Exact, so All is not also current on `?tab=unread`; the router then sets `aria-current="page"` on the current tab.
const exactMatch = { exact: true };

/** The signed-in user's notifications under All and Unread tabs (R10–R16, KTD11). */
export const Route = createFileRoute('/inbox/')({
  validateSearch: (search: Record<string, unknown>): InboxSearch =>
    search['tab'] === 'unread' ? { tab: 'unread' } : {},
  beforeLoad: requireUser,
  component: InboxPage,
});

function InboxPage() {
  const tab: InboxTab = Route.useSearch({ select: (search) => search.tab ?? 'all' });
  const list = useInfiniteQuery(inboxListOptions(tab));
  const count = useQuery(unreadCountOptions);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const focusHeading = useCallback(() => document.getElementById(HEADING_ID)?.focus(), []);
  const { mutate: mutateMarkAll } = markAll;
  // "Mark all as read" turns unavailable once nothing is unread, so focus moves to the heading.
  const onMarkAll = useCallback(
    () => mutateMarkAll(undefined, { onSuccess: focusHeading }),
    [mutateMarkAll, focusHeading],
  );

  if ([list.error, count.error, markRead.error, markAll.error].some(isSessionEnded)) return <SessionEnded />;
  return (
    <>
      <div className={styles.header}>
        <Heading level={1} id={HEADING_ID} tabIndex={-1} className={styles.heading}>
          Inbox
        </Heading>
        <Button variant="secondary" isDisabled={count.data === 0} isPending={markAll.isPending} onPress={onMarkAll}>
          Mark all as read
        </Button>
      </div>
      {markAll.isError ? <InlineAlert variant="danger" title="We could not mark all notifications as read." /> : null}
      <InboxTabs unread={count.data} />
      <InboxList key={tab} tab={tab} query={list} markRead={markRead} focusHeading={focusHeading} />
    </>
  );
}

/** Tabs are links (`?tab=unread`), so a tab is linkable and survives a reload; the router marks the current one. */
function InboxTabs({ unread }: Readonly<{ unread: number | undefined }>) {
  return (
    <nav aria-label="Inbox tabs" className={styles.tabs}>
      <Link to="/inbox" search={allTab} activeOptions={exactMatch} className={styles.tab}>
        All
      </Link>
      <Link to="/inbox" search={unreadTab} activeOptions={exactMatch} className={styles.tab}>
        {unread === undefined ? 'Unread' : `Unread (${unread})`}
      </Link>
    </nav>
  );
}

/** Any inbox request answered 401: the session is gone, so offer sign-in back to this page instead of a retry. */
function SessionEnded() {
  const href = useLocation({ select: (location) => location.href });
  return (
    <>
      <Heading level={1}>Inbox</Heading>
      <InlineAlert
        variant="warning"
        title="Your session ended"
        description="Sign in again to see your notifications."
      />
      <DesignSystemLink href={loginHref(href)}>Sign in</DesignSystemLink>
    </>
  );
}
