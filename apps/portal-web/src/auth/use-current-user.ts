import { type QueryClient, queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { fetchCurrentUser, type CurrentUser } from './api';

export const currentUserQueryKey = ['auth', 'me'] as const;

export const currentUserQueryOptions = queryOptions({
  queryKey: currentUserQueryKey,
  queryFn: fetchCurrentUser,
  // 401 is a normal answer (signed out), not a failure worth retrying.
  retry: false,
  staleTime: 60_000,
});

export function useCurrentUser(): UseQueryResult<CurrentUser | null> {
  return useQuery(currentUserQueryOptions);
}

/**
 * The current user for route guards, through the same cache as `useCurrentUser`: `null` when signed out, `undefined`
 * when portal-api could not say (logged with context here; the guard treats it as signed out).
 */
export async function lookUpCurrentUser(queryClient: QueryClient): Promise<CurrentUser | null | undefined> {
  try {
    return await queryClient.ensureQueryData(currentUserQueryOptions);
  } catch (error) {
    console.error('portal-web: could not load the current user', error);
    return undefined;
  }
}
