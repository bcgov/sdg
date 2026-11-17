import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useState } from 'react';

import type { FlagChanges, FlagOverride, Person } from '../../api/feature-flags';
import { listParams } from './table-search';
import { useDeleteFlag, useFlagDetail, useRemoveOverride, useSetOverride, useUpdateFlag } from './use-feature-flags';
import { type FlagFeedback, useFlagFeedback } from './use-flag-feedback';

/** Saves edits, then calls `onDone` (e.g. to close the dialog they came from). */
function useSave(key: string, { reset, confirm, fail }: FlagFeedback) {
  const { mutate, isPending } = useUpdateFlag();
  const save = useCallback(
    (changes: FlagChanges, onDone?: () => void) => {
      const attempt = () => {
        reset();
        mutate(
          { key, changes },
          {
            onSuccess: () => {
              confirm(`Saved ${key}.`);
              onDone?.();
            },
            onError: (error) => fail(error, key, attempt),
          },
        );
      };
      attempt();
    },
    [key, mutate, reset, confirm, fail],
  );
  return { save, isSaving: isPending };
}

function useOverrideChanges(key: string, { reset, confirm, fail }: FlagFeedback) {
  const { mutate: set, isPending: isSettingOverride } = useSetOverride();
  const { mutate: remove, isPending: isRemoving, variables: removing } = useRemoveOverride();
  // While the flag is off, an override waits for the switch (kill switch), so don't say it's in effect.
  const isFlagOn = useFlagDetail(key).data?.enabled ?? true;
  const setOverride = useCallback(
    (who: Person, enabled: boolean, onDone: () => void) => {
      const attempt = () => {
        reset();
        set(
          { key, principalId: who.principalId, enabled },
          {
            onSuccess: () => {
              const state = enabled ? 'on' : 'off';
              confirm(
                isFlagOn
                  ? `${key} is now ${state} for ${who.displayName}.`
                  : `Saved ${who.displayName}’s “${state}” override. It applies once ${key} is turned on.`,
              );
              onDone();
            },
            onError: (error) => fail(error, key, attempt),
          },
        );
      };
      attempt();
    },
    [key, set, reset, confirm, fail, isFlagOn],
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

/**
 * Deletes the flag once confirmed, then goes back to the list view it was opened from, which says so (R18, KTD10);
 * the list shows its last page if this one is now past the end (R14).
 */
function useDeletion(key: string, { reset, fail }: FlagFeedback) {
  const [isAskingDelete, setIsAskingDelete] = useState(false);
  const { mutate, isPending } = useDeleteFlag();
  const navigate = useNavigate();
  const search = useSearch({ from: '/_app/feature-flags/$key' });
  const confirmDelete = useCallback(() => {
    const attempt = () => {
      reset();
      mutate(key, {
        onSuccess: () => {
          setIsAskingDelete(false);
          void navigate({ to: '/feature-flags', search: { ...listParams(search), deleted: key } });
        },
        onError: (error) => {
          setIsAskingDelete(false);
          fail(error, key, attempt);
        },
      });
    };
    attempt();
  }, [key, mutate, navigate, search, reset, fail]);
  const askDelete = useCallback(() => setIsAskingDelete(true), []);
  const cancelDelete = useCallback(() => setIsAskingDelete(false), []);
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
