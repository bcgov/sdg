import { Button } from '@repo/design-system/components/button';
import { InlineAlert } from '@repo/design-system/components/inline-alert';
import { useCallback, useMemo } from 'react';

import { ApiError, apiErrorKind } from '../../api/http';

/** A refused or failed registry call, as the screen shows it. */
export interface Notice {
  readonly variant: 'danger' | 'warning';
  readonly title: string;
  readonly description: string;
  readonly retry?: () => void;
  readonly reload?: boolean;
}

/**
 * The notice for a registry call that failed, or null when the app already left the screen (a 401 or core-api's 403,
 * see useRefusalRedirects). `subject` names what was being loaded or changed, e.g. a client id.
 */
export function failureNotice(error: unknown, subject: string, retry: () => void): Notice | null {
  switch (apiErrorKind(error)) {
    case 'session-ended':
    case 'not-authorized':
      return null;
    case 'unavailable':
      return {
        variant: 'danger',
        title: 'The service is temporarily unavailable',
        description: `Nothing was changed for ${subject}. Try again in a moment.`,
        retry,
      };
    case 'blocked':
      return {
        variant: 'danger',
        title: 'The request was blocked',
        description: 'Reload the page and try again.',
        reload: true,
      };
    case 'not-found':
      return {
        variant: 'warning',
        title: `${subject} was already removed by another administrator`,
        description: 'The list now shows the current registry.',
      };
    case 'invalid':
      return {
        variant: 'danger',
        title: `${subject} could not be changed`,
        description: error instanceof ApiError ? error.reasons.join(' ') : '',
      };
    default:
      return {
        variant: 'danger',
        title: 'Something went wrong',
        description: `The change to ${subject} may not have been saved. Reload the page to see the current registry.`,
        reload: true,
      };
  }
}

/** The notice for a list or history load that failed, or null when the app already left the screen. */
export function loadFailureNotice(error: unknown, what: string, retry: () => void): Notice | null {
  const kind = apiErrorKind(error);
  if (kind === 'session-ended' || kind === 'not-authorized') return null;
  if (kind === 'blocked') return failureNotice(error, what, retry);
  return {
    variant: 'danger',
    title: kind === 'unavailable' ? 'The service is temporarily unavailable' : 'Something went wrong',
    description: `${what} couldn't be loaded. Try again in a moment.`,
    retry,
  };
}

const reloadPage = () => window.location.reload();

interface NoticeAlertProps {
  notice: Notice;
  /** Makes the alert closeable. */
  onDismiss?: () => void;
}

/** A failure in an assertive live region, with a retry or reload when one helps. */
export function NoticeAlert({ notice, onDismiss }: NoticeAlertProps) {
  const { retry, reload } = notice;
  const onRetry = useCallback(() => {
    onDismiss?.();
    retry?.();
  }, [onDismiss, retry]);
  const buttons = useMemo(() => {
    if (retry) return <Button onPress={onRetry}>Try again</Button>;
    if (reload) return <Button onPress={reloadPage}>Reload the page</Button>;
    return undefined;
  }, [retry, reload, onRetry]);
  return (
    <InlineAlert
      variant={notice.variant}
      role="alert"
      title={notice.title}
      description={notice.description}
      isCloseable={onDismiss !== undefined}
      onClose={onDismiss}
      buttons={buttons}
    />
  );
}
