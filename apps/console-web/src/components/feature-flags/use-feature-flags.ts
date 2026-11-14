import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import {
  createFlag,
  deleteFlag,
  fetchFlag,
  fetchFlagHistory,
  listFlags,
  removeOverride,
  searchPeople,
  setOverride,
  updateFlag,
  type Audience,
  type FlagChanges,
  type FlagDetail,
  type FlagOverride,
  type FlagSummary,
  type NewFlag,
} from '../../api/feature-flags';

export const flagAdminKeys = {
  all: ['feature-flag-admin'] as const,
  flags: ['feature-flag-admin', 'flags'] as const,
  list: ['feature-flag-admin', 'flags', 'list'] as const,
  detail: (key: string) => ['feature-flag-admin', 'flags', 'detail', key] as const,
  history: ['feature-flag-admin', 'history'] as const,
  historyFor: (key: string) => ['feature-flag-admin', 'history', key] as const,
  people: (audience: Audience, query: string) => ['feature-flag-admin', 'people', audience, query] as const,
};

const FIRST_PAGE: number | undefined = undefined;

export function useFlagList() {
  return useQuery({ queryKey: flagAdminKeys.list, queryFn: listFlags });
}

export function useFlagDetail(key: string) {
  return useQuery({ queryKey: flagAdminKeys.detail(key), queryFn: () => fetchFlag(key) });
}

/** One flag's history newest first, a page at a time, deleted or not. */
export function useFlagHistory(key: string) {
  return useInfiniteQuery({
    queryKey: flagAdminKeys.historyFor(key),
    queryFn: ({ pageParam }) => fetchFlagHistory(key, pageParam),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (lastPage) => lastPage.nextBefore ?? undefined,
  });
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

const byKey = (a: FlagSummary, b: FlagSummary) => (a.key < b.key ? -1 : 1);

/**
 * Shows a change core-api confirmed at once, then refetches. Nothing changes in the cache before core-api answers, so
 * a refused change never looks applied.
 */
function applyToList(queryClient: QueryClient, change: (flags: FlagSummary[]) => FlagSummary[]): void {
  queryClient.setQueryData<FlagSummary[]>(flagAdminKeys.list, (flags) => flags && change(flags));
  refetchFlags(queryClient);
}

const withSummary = (summary: FlagSummary) => (flags: FlagSummary[]) =>
  [...flags.filter(({ key }) => key !== summary.key), summary].toSorted(byKey);

export function useCreateFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (flag: NewFlag) => createFlag(flag),
    onSuccess: (summary) => applyToList(queryClient, withSummary(summary)),
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
      applyToList(queryClient, withSummary(summary));
    },
  });
}

export function useDeleteFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => deleteFlag(key),
    onSuccess: (_, deleted) => applyToList(queryClient, (flags) => flags.filter(({ key }) => key !== deleted)),
  });
}

/** The detail with `overrides`, its counts recomputed, and the list's counts to match. */
function applyOverrides(queryClient: QueryClient, key: string, change: (list: FlagOverride[]) => FlagOverride[]) {
  const detail = queryClient.getQueryData<FlagDetail>(flagAdminKeys.detail(key));
  if (detail) {
    const overrides = change([...detail.overrides]).toSorted((a, b) => (a.name < b.name ? -1 : 1));
    const overrideCounts = {
      on: overrides.filter(({ enabled }) => enabled).length,
      off: overrides.filter(({ enabled }) => !enabled).length,
    };
    queryClient.setQueryData<FlagDetail>(flagAdminKeys.detail(key), { ...detail, overrides, overrideCounts });
    const { overrides: _overrides, ...summary } = { ...detail, overrides, overrideCounts };
    applyToList(queryClient, (flags) => flags.map((flag) => (flag.key === key ? summary : flag)));
  } else {
    refetchFlags(queryClient);
  }
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
