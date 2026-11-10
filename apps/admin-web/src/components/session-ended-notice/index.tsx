import { InlineAlert } from '@repo/design-system/components/inline-alert';
import { Link } from '@repo/design-system/components/link';
import { useMemo } from 'react';

import { loginHref } from '../../auth/api';

interface SessionEndedNoticeProps {
  returnTo: string;
  onDismiss: () => void;
}

/** Shown on the landing after admin-api answered 401: the session is gone, so the only way on is signing in. */
export function SessionEndedNotice({ returnTo, onDismiss }: SessionEndedNoticeProps) {
  const signIn = useMemo(() => <Link href={loginHref(returnTo)}>Sign in again</Link>, [returnTo]);
  return (
    <InlineAlert
      variant="warning"
      role="alert"
      title="Your session ended"
      description="Sign in again to continue."
      isCloseable
      onClose={onDismiss}
      buttons={signIn}
    />
  );
}
