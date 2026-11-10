import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query';

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
