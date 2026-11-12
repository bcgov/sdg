import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import {
  addServiceClient,
  fetchHistory,
  listServiceClients,
  removeServiceClient,
  setServiceClientEnabled,
  type NewServiceClient,
  type ServiceClient,
} from '../../api/service-clients';

export const registryKeys = {
  all: ['registry'] as const,
  list: ['registry', 'clients'] as const,
  history: ['registry', 'history'] as const,
};

const FIRST_PAGE: number | undefined = undefined;

export function useServiceClients() {
  return useQuery({ queryKey: registryKeys.list, queryFn: listServiceClients });
}

/** The registry's history, newest first, a page at a time (`nextBefore`). */
export function useRegistryHistory() {
  return useInfiniteQuery({
    queryKey: registryKeys.history,
    queryFn: ({ pageParam }) => fetchHistory(pageParam),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (lastPage) => lastPage.nextBefore ?? undefined,
  });
}

const byClientId = (a: ServiceClient, b: ServiceClient) => (a.clientId < b.clientId ? -1 : 1);

/**
 * Shows a change core-api confirmed at once, then refetches the list and the history (which now records it). Nothing
 * changes in the cache before core-api answers, so a refused change never looks applied.
 */
function applyConfirmed(queryClient: QueryClient, change: (clients: ServiceClient[]) => ServiceClient[]): void {
  queryClient.setQueryData<ServiceClient[]>(registryKeys.list, (clients) => clients && change(clients));
  void queryClient.invalidateQueries({ queryKey: registryKeys.all });
}

/** Refetches everything, e.g. after a 404 shows another administrator changed the registry. */
export function useRefreshRegistry(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => void queryClient.invalidateQueries({ queryKey: registryKeys.all }), [queryClient]);
}

const withClient = (client: ServiceClient) => (clients: ServiceClient[]) =>
  [...clients.filter(({ clientId }) => clientId !== client.clientId), client].toSorted(byClientId);

export function useAddServiceClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (client: NewServiceClient) => addServiceClient(client),
    onSuccess: (client) => applyConfirmed(queryClient, withClient(client)),
  });
}

export function useSetServiceClientEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, enabled }: { clientId: string; enabled: boolean }) =>
      setServiceClientEnabled(clientId, enabled),
    onSuccess: (client) => applyConfirmed(queryClient, withClient(client)),
  });
}

export function useRemoveServiceClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => removeServiceClient(clientId),
    onSuccess: (_, removed) =>
      applyConfirmed(queryClient, (clients) => clients.filter(({ clientId }) => clientId !== removed)),
  });
}
