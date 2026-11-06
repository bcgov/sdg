import type { QueryClient, QueryKey } from '@tanstack/react-query';

/** The header portal-api reads to tell background traffic from user activity (KTD8). */
export const BACKGROUND_HEADER = 'sdg-background';

/**
 * A fetch of a query that already has data, other than "Load more", is a refetch (a change signal, focus, a tab
 * revisit), not a user action, so it must carry `sdg-background: 1` and never extend the sign-in (KTD8, R35).
 */
export function isRefetch(client: QueryClient, queryKey: QueryKey): boolean {
  const state = client.getQueryState(queryKey);
  return state?.data !== undefined && state.fetchMeta?.fetchMore === undefined;
}
