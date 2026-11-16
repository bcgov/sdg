import type { DataTableStatus } from '@repo/design-system/components/data-table';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback } from 'react';

import {
  createFlag,
  deleteFlag,
  fetchFlag,
  listFlags,
  listHistory,
  removeOverride,
  searchPeople,
  setOverride,
  updateFlag,
  type Audience,
  type FlagChanges,
  type FlagDetail,
  type FlagHistoryQuery,
  type FlagListPage,
  type FlagListQuery,
  type FlagOverride,
  type NewFlag,
} from '../../api/feature-flags';
import { apiErrorKind } from '../../api/http';

export const flagAdminKeys = {
  all: ['feature-flag-admin'] as const,
  flags: ['feature-flag-admin', 'flags'] as const,
  list: ['feature-flag-admin', 'flags', 'list'] as const,
  listPage: (query: FlagListQuery) => ['feature-flag-admin', 'flags', 'list', query] as const,
  detail: (key: string) => ['feature-flag-admin', 'flags', 'detail', key] as const,
  history: ['feature-flag-admin', 'history'] as const,
  historyPage: (query: FlagHistoryQuery) => ['feature-flag-admin', 'history', query.key, query] as const,
  people: (audience: Audience, query: string) => ['feature-flag-admin', 'people', audience, query] as const,
};

/** One page of the flag list; the previous page stays on screen while the next loads (KTD11). */
export function useFlagList(query: FlagListQuery) {
  return useQuery({
    queryKey: flagAdminKeys.listPage(query),
    queryFn: () => listFlags(query),
    placeholderData: keepPreviousData,
  });
}

export function useFlagDetail(key: string) {
  return useQuery({ queryKey: flagAdminKeys.detail(key), queryFn: () => fetchFlag(key) });
}

/** One page of a flag's history, deleted or not, by its cursor; the previous page stays while the next loads. */
export function useFlagHistory(query: FlagHistoryQuery) {
  return useQuery({
    queryKey: flagAdminKeys.historyPage(query),
    queryFn: () => listHistory(query),
    placeholderData: keepPreviousData,
  });
}

/** Where a DataTable's rows stand: a search the edge refused is `blocked` (KTD12), any other failure an `error`. */
export function tableStatus({ isError, error, isPending, isPlaceholderData }: UseQueryResult): DataTableStatus {
  if (isError) return apiErrorKind(error) === 'blocked' ? 'blocked' : 'error';
  if (isPending) return 'loading';
  return isPlaceholderData ? 'refreshing' : 'ready';
}

/** People in the flag's audience matching `query`; runs only while `enabled` (2 characters or more). */
export function usePeopleSearch(query: string, audience: Audience, enabled: boolean) {
  return useQuery({
    queryKey: flagAdminKeys.people(audience, query),
    queryFn: () => searchPeople(query, audience),
    enabled,
  });
}

/** Refetches the flags and the history (never a people search), e.g. after a 404 or a confirmed change. */
function refetchFlags(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: flagAdminKeys.flags });
  void queryClient.invalidateQueries({ queryKey: flagAdminKeys.history });
}

export function useRefreshFlags(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => refetchFlags(queryClient), [queryClient]);
}

export function useCreateFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (flag: NewFlag) => createFlag(flag),
    onSuccess: () => refetchFlags(queryClient),
  });
}

export function useUpdateFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, changes }: { key: string; changes: FlagChanges }) => updateFlag(key, changes),
    onSuccess: (summary) => {
      queryClient.setQueryData<FlagDetail>(flagAdminKeys.detail(summary.key), (detail) =>
        detail ? { ...detail, ...summary } : detail,
      );
      refetchFlags(queryClient);
    },
  });
}

export function useDeleteFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => deleteFlag(key),
    onSuccess: (_, deleted) => {
      // The list is unmounted behind the flag page, so its cached pages only go stale; drop the row before it remounts.
      queryClient.setQueriesData<FlagListPage>({ queryKey: flagAdminKeys.list }, (page) =>
        page?.items.some(({ key }) => key === deleted)
          ? { ...page, items: page.items.filter(({ key }) => key !== deleted), total: page.total - 1 }
          : page,
      );
      refetchFlags(queryClient);
    },
  });
}

/** The detail with `overrides` and its counts recomputed; the list refetches to match. */
function applyOverrides(queryClient: QueryClient, key: string, change: (list: FlagOverride[]) => FlagOverride[]) {
  const detail = queryClient.getQueryData<FlagDetail>(flagAdminKeys.detail(key));
  if (detail) {
    const overrides = change([...detail.overrides]).toSorted((a, b) => (a.name < b.name ? -1 : 1));
    const overrideCounts = {
      on: overrides.filter(({ enabled }) => enabled).length,
      off: overrides.filter(({ enabled }) => !enabled).length,
    };
    queryClient.setQueryData<FlagDetail>(flagAdminKeys.detail(key), { ...detail, overrides, overrideCounts });
  }
  refetchFlags(queryClient);
}

interface OverrideChange {
  readonly key: string;
  readonly principalId: string;
}

export function useSetOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, principalId, enabled }: OverrideChange & { enabled: boolean }) =>
      setOverride(key, principalId, enabled),
    onSuccess: (set, { key }) =>
      applyOverrides(queryClient, key, (overrides) => [
        ...overrides.filter(({ principalId }) => principalId !== set.principalId),
        set,
      ]),
  });
}

export function useRemoveOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, principalId }: OverrideChange) => removeOverride(key, principalId),
    onSuccess: (_, { key, principalId: removed }) =>
      applyOverrides(queryClient, key, (overrides) => overrides.filter(({ principalId }) => principalId !== removed)),
  });
}
