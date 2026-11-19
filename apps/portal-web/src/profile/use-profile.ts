import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { fetchProfile, type Profile } from './api';

export const profileQueryOptions = queryOptions({
  queryKey: ['portal', 'profile'] as const,
  queryFn: fetchProfile,
  // A failed load shows Settings' error state at once (R14) rather than after React Query's default retries.
  retry: false,
});

/** The live profile, held only in React Query's in-memory cache (R17). */
export function useProfile(): UseQueryResult<Profile> {
  return useQuery(profileQueryOptions);
}
