import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';

import type { FlagChanges, FlagOverride, Person } from '../../api/feature-flags';
import { useDeleteFlag, useRemoveOverride, useSetOverride, useUpdateFlag } from './use-feature-flags';
import { type FlagFeedback, useFlagFeedback } from './use-flag-feedback';

/**
 * Saves edits. After core-api answers a PATCH that turned the flag off while people still have "on" overrides, the
 * off notice (R21) is raised; it stays until dismissed or a save turns the flag back on.
 */
function useSave(key: string, { reset, confirm, fail }: FlagFeedback) {
  const [offNotice, setOffNotice] = useState(false);
  const { mutate, isPending } = useUpdateFlag();
  const save = useCallback(
    (changes: FlagChanges) => {
      const attempt = () => {
        reset();
        mutate(
          { key, changes },
          {
            onSuccess: (summary) => {
              confirm(`Saved ${key}.`);
              if (summary.enabled) setOffNotice(false);
              else if (changes.enabled === false && summary.overrideCounts.on > 0) setOffNotice(true);
            },
            onError: (error) => fail(error, key, attempt),
          },
        );
      };
      attempt();
    },
    [key, mutate, reset, confirm, fail],
  );
  const dismissOffNotice = useCallback(() => setOffNotice(false), []);
  return { save, isSaving: isPending, offNotice, dismissOffNotice };
}

function useOverrideChanges(key: string, { reset, confirm, fail }: FlagFeedback) {
  const { mutate: set, isPending: isSettingOverride } = useSetOverride();
  const { mutate: remove, isPending: isRemoving, variables: removing } = useRemoveOverride();
  const setOverride = useCallback(
    (who: Person, enabled: boolean, onDone: () => void) => {
      const attempt = () => {
        reset();
        set(
          { key, principalId: who.principalId, enabled },
          {
            onSuccess: () => {
              confirm(`${key} is now ${enabled ? 'on' : 'off'} for ${who.displayName}.`);
              onDone();
            },
            onError: (error) => fail(error, key, attempt),
          },
        );
      };
      attempt();
    },
    [key, set, reset, confirm, fail],
  );
  const removeOverride = useCallback(
    (override: FlagOverride) => {
      const attempt = () => {
        reset();
        remove(
          { key, principalId: override.principalId },
          {
            onSuccess: () => confirm(`Removed the override for ${override.name}.`),
            onError: (error) => fail(error, `The override for ${override.name}`, attempt),
          },
        );
      };
      attempt();
    },
    [key, remove, reset, confirm, fail],
  );
  const busyPrincipal = isRemoving ? removing?.principalId : undefined;
  return { setOverride, isSettingOverride, removeOverride, busyPrincipal };
}

/** Deletes the flag once confirmed, then goes back to the list, which says so (R17). */
function useDeletion(key: string, { reset, fail }: FlagFeedback) {
  const [isAskingDelete, setAsking] = useState(false);
  const { mutate, isPending } = useDeleteFlag();
  const navigate = useNavigate();
  const confirmDelete = useCallback(() => {
    const attempt = () => {
      reset();
      mutate(key, {
        onSuccess: () => {
          setAsking(false);
          void navigate({ to: '/feature-flags', search: { deleted: key } });
        },
        onError: (error) => {
          setAsking(false);
          fail(error, key, attempt);
        },
      });
    };
    attempt();
  }, [key, mutate, navigate, reset, fail]);
  const askDelete = useCallback(() => setAsking(true), []);
  const cancelDelete = useCallback(() => setAsking(false), []);
  return { isAskingDelete, askDelete, cancelDelete, confirmDelete, isDeleting: isPending };
}

/**
 * Edits, overrides, delete and their feedback on a flag's page; a 404 refetches, so a flag another administrator
 * deleted shows as deleted.
 */
export function useDetailActions(key: string) {
  const feedback = useFlagFeedback();
  return {
    ...feedback,
    ...useSave(key, feedback),
    ...useOverrideChanges(key, feedback),
    ...useDeletion(key, feedback),
  };
}

export type DetailActions = ReturnType<typeof useDetailActions>;
