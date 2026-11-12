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
 * For route guards: the signed-in user, `null` when signed out, or `undefined` when console-api could not say (the
 * query keeps the error, so the sign-in card can tell the administrator).
 */
export async function lookUpCurrentUser(queryClient: QueryClient): Promise<CurrentUser | null | undefined> {
  try {
    return await queryClient.ensureQueryData(currentUserQueryOptions);
  } catch (error) {
    console.error('console-web: could not load the current user', error);
    return undefined;
  }
}
