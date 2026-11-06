import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { isRefetch } from '../background-fetch';
import { fetchCurrentUser, type CurrentUser } from './api';

export const currentUserQueryKey = ['auth', 'me'] as const;

export const currentUserQueryOptions = queryOptions({
  queryKey: currentUserQueryKey,
  // A refetch (focus, or a change the header reported) is background traffic (KTD8).
  queryFn: ({ client, queryKey }) => fetchCurrentUser(isRefetch(client, queryKey)),
  // 401 is a normal answer (signed out), not a failure worth retrying.
  retry: false,
  staleTime: 60_000,
});

export function useCurrentUser(): UseQueryResult<CurrentUser | null> {
  return useQuery(currentUserQueryOptions);
}
