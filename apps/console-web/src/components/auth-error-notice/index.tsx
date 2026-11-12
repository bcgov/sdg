import { InlineAlert } from '@repo/design-system/components/inline-alert';
import { Link } from '@repo/design-system/components/link';
import { useMemo } from 'react';

import { loginHref } from '../../auth/api';
import type { AuthErrorCode } from '../../auth/auth-error';

interface AuthErrorNoticeProps {
  code: AuthErrorCode;
  /** Where a retry returns to after signing in. */
  returnTo: string;
  onDismiss: () => void;
}

/**
 * Inline notice for a failed sign-in. The retry is a fresh login: the callback's code exchange is single-use, so
 * the failed attempt can't be replayed. `access_denied` means the person declined, so no retry is offered.
 */
export function AuthErrorNotice({ code, returnTo, onDismiss }: Readonly<AuthErrorNoticeProps>) {
  const description =
    code === 'unavailable'
      ? 'The service is temporarily unavailable. Try again in a few minutes.'
      : 'Something went wrong while signing you in.';
  const retry = useMemo(
    () => (code === 'access_denied' ? undefined : <Link href={loginHref(returnTo)}>Try again</Link>),
    [code, returnTo],
  );
  return (
    <InlineAlert
      variant="danger"
      role="alert"
      title="Sign-in didn't complete"
      description={description}
      isCloseable
      onClose={onDismiss}
      buttons={retry}
    />
  );
}
