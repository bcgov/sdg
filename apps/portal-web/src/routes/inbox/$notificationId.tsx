import { Button } from '@repo/design-system/components/button';
import { Heading } from '@repo/design-system/components/heading';
import { InlineAlert } from '@repo/design-system/components/inline-alert';
import { Text } from '@repo/design-system/components/text';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, notFound, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useCallback, useEffect, useRef } from 'react';

import { requireUser } from '../../auth/require-user';
import { NotFound } from '../../components/not-found';
import { BackToInbox, NotificationDetail } from '../../components/notification-detail';
import { SessionEnded } from '../../components/session-ended';
import { isNotFound, isSessionEnded, type InboxItemDetail } from '../../inbox/api';
import { itemByNotificationOptions, useMarkRead } from '../../inbox/queries';

/**
 * One notification, marked read once it has rendered unread (R16–R19, KTD12). The loader only reads, because the
 * router preloads on intent: hovering a link must never mark anything read.
 */
export const Route = createFileRoute('/inbox/$notificationId')({
  beforeLoad: requireUser,
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(itemByNotificationOptions(params.notificationId));
    } catch (error) {
      // Missing, malformed and someone else's all answer 404, and all look the same (R18).
      if (isNotFound(error)) throw notFound();
      throw error;
    }
  },
  pendingComponent: NotificationPending,
  notFoundComponent: NotFound,
  errorComponent: NotificationError,
  component: NotificationPage,
});

function NotificationPage() {
  const { notificationId } = Route.useParams();
  const { data: item, error } = useSuspenseQuery(itemByNotificationOptions(notificationId));
  const markRead = useMarkRead();
  useReadOnOpen(item, markRead.mutate);

  if ([error, markRead.error].some(isSessionEnded)) return <SessionEnded />;
  return <NotificationDetail item={item} />;
}

/** Posts one read for an item shown unread, whatever the entry point (R18); never again for the same item. */
function useReadOnOpen(item: InboxItemDetail, mutate: (itemId: string) => void): void {
  const posted = useRef<string | null>(null);
  useEffect(() => {
    if (item.readAt !== null || posted.current === item.id) return;
    posted.current = item.id;
    mutate(item.id);
  }, [item.id, item.readAt, mutate]);
}

function NotificationPending() {
  return <Text elementType="p">Loading notification…</Text>;
}

/** Any failure but a 404: a retry and a way back to the inbox, or sign-in when the session ended. */
function NotificationError({ error }: Readonly<ErrorComponentProps>) {
  const router = useRouter();
  // Re-runs the loader, which fetches again because a failed query holds no data.
  const retry = useCallback(() => void router.invalidate(), [router]);
  if (isSessionEnded(error)) return <SessionEnded />;
  return (
    <>
      <Heading level={1}>Notification</Heading>
      <InlineAlert variant="danger" title="We could not load this notification." />
      <p>
        <Button variant="secondary" onPress={retry}>
          Try again
        </Button>
      </p>
      <p>
        <BackToInbox />
      </p>
    </>
  );
}
