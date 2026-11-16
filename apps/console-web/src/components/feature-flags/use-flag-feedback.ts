import { useMemo, useState } from 'react';

import { apiErrorKind } from '../../api/http';
import { failureNotice, type Notice } from '../service-clients/notice';
import { useRefreshFlags } from './use-feature-flags';

/**
 * The notice for a flag change that failed, or null when the app already left the screen (a 401 or core-api's 403).
 * `subject` names what was being changed, e.g. a flag key. A 404 means another administrator got there first.
 */
export function flagFailureNotice(error: unknown, subject: string, retry: () => void): Notice | null {
  const kind = apiErrorKind(error);
  if (kind === 'not-found') {
    return {
      variant: 'warning',
      title: `${subject} was already removed by another administrator`,
      description: 'The page now shows the current feature flags.',
    };
  }
  if (kind === 'unexpected' || kind === 'conflict') {
    return {
      variant: 'danger',
      title: 'Something went wrong',
      description: `The change to ${subject} may not have been saved. Reload the page to see the current feature flags.`,
      reload: true,
    };
  }
  return failureNotice(error, subject, retry);
}

/**
 * What the screen says about flag changes: the last one core-api confirmed, or why the last one failed. A 404 refetches
 * the flags, so the page shows what another administrator left.
 */
export function useFlagFeedback() {
  const [status, setStatus] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const refresh = useRefreshFlags();

  const actions = useMemo(
    () => ({
      /** A change is starting: nothing is confirmed or refused yet. */
      reset: () => {
        setStatus('');
        setNotice(null);
      },
      confirm: setStatus,
      fail: (error: unknown, subject: string, retry: () => void) => {
        setNotice(flagFailureNotice(error, subject, retry));
        if (apiErrorKind(error) === 'not-found') refresh();
      },
      dismiss: () => setNotice(null),
    }),
    [refresh],
  );
  return { status, notice, ...actions };
}

export type FlagFeedback = Pick<ReturnType<typeof useFlagFeedback>, 'reset' | 'confirm' | 'fail'>;
