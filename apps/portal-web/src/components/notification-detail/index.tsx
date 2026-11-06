import { Heading } from '@repo/design-system/components/heading';
import { Link as DesignSystemLink } from '@repo/design-system/components/link';
import { useMemo } from 'react';

import type { InboxItemDetail } from '../../inbox/api';
import { Link } from '../link';

import styles from './notification-detail.module.css';

const received = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

/** "Back to inbox", on the notification page and its error page (R17). */
export function BackToInbox() {
  return <Link to="/inbox">Back to inbox</Link>;
}

/** One notification: title, date received, full message and the sender's action link as a button (R17, KTD12). */
export function NotificationDetail({ item }: Readonly<{ item: InboxItemDetail }>) {
  // notification-api sanitizes the body before storing it, so it renders as HTML.
  const body = useMemo(() => (item.body === null ? null : { __html: item.body }), [item.body]);
  return (
    <article className={styles.detail}>
      <Heading level={1} className={styles.title}>
        {item.title ?? 'Notification'}
      </Heading>
      <time className={styles.received} dateTime={item.createdAt}>
        {received.format(new Date(item.createdAt))}
      </time>
      {body === null ? null : <div className={styles.body} dangerouslySetInnerHTML={body} />}
      {item.actionUrl === null ? null : (
        <p>
          <DesignSystemLink href={item.actionUrl} isButton>
            Open link
          </DesignSystemLink>
        </p>
      )}
      <p>
        <BackToInbox />
      </p>
    </article>
  );
}
