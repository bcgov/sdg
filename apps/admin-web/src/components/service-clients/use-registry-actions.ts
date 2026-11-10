import { useCallback, useMemo, useState } from 'react';

import { apiErrorKind } from '../../api/http';
import type { ServiceClient } from '../../api/service-clients';
import { failureNotice, type Notice } from './notice';
import { useRefreshRegistry, useRemoveServiceClient, useSetServiceClientEnabled } from './use-registry';

/** What the screen says about registry changes: the last confirmed one, or why the last one failed. */
function useFeedback(onListChanged: () => void) {
  const [status, setStatus] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const refresh = useRefreshRegistry();

  const actions = useMemo(
    () => ({
      /** A change is starting: nothing is confirmed or refused yet. */
      reset: () => {
        setStatus('');
        setNotice(null);
      },
      /** core-api confirmed the change (R32). */
      confirm: setStatus,
      fail: (error: unknown, clientId: string, retry: () => void) => {
        setNotice(failureNotice(error, clientId, retry));
        // 404: another administrator removed it; show the registry as it is now.
        if (apiErrorKind(error) === 'not-found') {
          refresh();
          onListChanged();
        }
      },
      dismiss: () => setNotice(null),
    }),
    [refresh, onListChanged],
  );
  return { status, notice, ...actions };
}

type Feedback = Pick<ReturnType<typeof useFeedback>, 'reset' | 'confirm' | 'fail'>;

function useToggle({ reset, confirm, fail }: Feedback) {
  const { mutate, isPending, variables } = useSetServiceClientEnabled();
  const toggle = useCallback(
    (client: ServiceClient) => {
      const change = { clientId: client.clientId, enabled: !client.enabled };
      const attempt = () => {
        reset();
        mutate(change, {
          onSuccess: () => confirm(`${change.enabled ? 'Enabled' : 'Disabled'} ${change.clientId}.`),
          onError: (error) => fail(error, change.clientId, attempt),
        });
      };
      attempt();
    },
    [mutate, reset, confirm, fail],
  );
  return { toggle, busyClientId: isPending ? variables?.clientId : undefined };
}

function useRemoval({ reset, confirm, fail }: Feedback, onListChanged: () => void) {
  const [removing, setRemoving] = useState<ServiceClient | null>(null);
  const { mutate, isPending } = useRemoveServiceClient();
  const confirmRemove = useCallback(() => {
    if (removing === null) return;
    const { clientId } = removing;
    const attempt = () => {
      reset();
      mutate(clientId, {
        onSuccess: () => {
          setRemoving(null);
          confirm(`Removed ${clientId}.`);
          onListChanged();
        },
        onError: (error) => {
          setRemoving(null);
          fail(error, clientId, attempt);
        },
      });
    };
    attempt();
  }, [removing, mutate, reset, confirm, fail, onListChanged]);
  const cancelRemove = useCallback(() => setRemoving(null), []);
  return { removing, askRemove: setRemoving, confirmRemove, cancelRemove, isRemoving: isPending };
}

/**
 * Disable, enable and remove, with a success message only once core-api confirmed the change (R32), a notice for a
 * refusal, and a refetch when another administrator got there first (404). `onListChanged` runs when a row
 * disappeared, so focus can move somewhere that still exists.
 */
export function useRegistryActions(onListChanged: () => void) {
  const feedback = useFeedback(onListChanged);
  return { ...feedback, ...useToggle(feedback), ...useRemoval(feedback, onListChanged) };
}
