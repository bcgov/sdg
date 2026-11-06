import { Heading } from '@repo/design-system/components/heading';
import { InlineAlert } from '@repo/design-system/components/inline-alert';
import { Link } from '@repo/design-system/components/link';
import { useLocation } from '@tanstack/react-router';

import { loginHref } from '../../auth/api';

/** Any inbox request answered 401: the session is gone, so offer sign-in back to this page instead of a retry. */
export function SessionEnded() {
  const href = useLocation({ select: (location) => location.href });
  return (
    <>
      <Heading level={1}>Inbox</Heading>
      <InlineAlert
        variant="warning"
        title="Your session ended"
        description="Sign in again to see your notifications."
      />
      <Link href={loginHref(href)}>Sign in</Link>
    </>
  );
}
