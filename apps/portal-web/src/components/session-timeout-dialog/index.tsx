import { AlertDialog } from '@repo/design-system/components/alert-dialog';
import { Button } from '@repo/design-system/components/button';
import { Modal } from '@repo/design-system/components/modal';
import { Text } from '@repo/design-system/components/text';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { logout } from '../../auth/api';
import { currentUserQueryKey, useCurrentUser } from '../../auth/use-current-user';
import { useSessionKeepAlive } from '../../auth/use-session-keep-alive';

/** How long before the session lapses the warning opens. */
export const WARNING_LEAD_MS = 2 * 60_000;
/** How often the countdown is re-read while a deadline is known. */
const TICK_MS = 15_000;

function minutesLeft(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** The current time, re-read every TICK_MS while `active` (so up to TICK_MS stale, which the countdown tolerates). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * Keeps a signed-in resident's session alive while they use the site (`useSessionKeepAlive`) and warns them
 * WARNING_LEAD_MS before an idle session lapses, so they can stay signed in with one action (WCAG 2.2.1). When the
 * deadline passes it asks portal-api once more: a 401 means the session ended, and `useSessionEndedRedirect` takes
 * over; a renewal from another tab simply moves the deadline.
 */
export function SessionTimeoutDialog() {
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const signedIn = Boolean(user);
  const { idleExpiresAt, renew } = useSessionKeepAlive(signedIn);
  const now = useNow(signedIn && idleExpiresAt !== null);

  const remaining = idleExpiresAt === null ? null : idleExpiresAt - now;
  const isOpen = signedIn && remaining !== null && remaining > 0 && remaining <= WARNING_LEAD_MS;
  const expired = signedIn && remaining !== null && remaining <= 0;

  useEffect(() => {
    if (expired) renew();
  }, [expired, renew]);

  const signOut = useCallback(() => {
    void logout(() => queryClient.setQueryData(currentUserQueryKey, null));
  }, [queryClient]);

  const buttons = useMemo(
    () => (
      <>
        <Button variant="secondary" onPress={signOut}>
          Sign out
        </Button>
        <Button variant="primary" onPress={renew}>
          Stay signed in
        </Button>
      </>
    ),
    [renew, signOut],
  );

  return (
    <Modal isOpen={isOpen} isDismissable={false} isKeyboardDismissDisabled>
      <AlertDialog
        role="alertdialog"
        aria-label="You’ll be signed out soon"
        title="You’ll be signed out soon"
        isCloseable={false}
        buttons={buttons}
      >
        <Text elementType="p">
          For your security, you’ll be signed out in <span aria-live="polite">{minutesLeft(remaining ?? 0)}</span>{' '}
          because you haven’t been active. Choose Stay signed in to keep working.
        </Text>
      </AlertDialog>
    </Modal>
  );
}
