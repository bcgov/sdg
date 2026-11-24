import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { addServiceClient, fetchHistory, listServiceClients, setServiceClientEnabled } from '../../api/service-clients';
import { fakeConsoleApi, serviceClient } from '../../test-support/fake-console-api';
import {
  registryKeys,
  useAddServiceClient,
  useRefreshRegistry,
  useRegistryHistory,
  useRemoveServiceClient,
  useServiceClients,
  useSetServiceClientEnabled,
} from './use-registry';

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('use-registry hooks', () => {
  it('Should sort clients by clientId in both directions and handle cached/uncached updates', async () => {
    const api = fakeConsoleApi({
      clients: [serviceClient('zulu'), serviceClient('alpha')],
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = createWrapper(queryClient);

    // Uncached list update (clients === undefined in applyConfirmed, line 43 falsy branch)
    const { result: removeHook } = renderHook(() => useRemoveServiceClient(), { wrapper });
    await act(async () => {
      await removeHook.current.mutateAsync('zulu');
    });

    // Populate list cache with multiple clients so byClientId (line 36) runs in both directions
    api.clients = [serviceClient('zulu'), serviceClient('alpha')];
    const { result: listHook } = renderHook(() => useServiceClients(), { wrapper });
    await waitFor(() => expect(listHook.current.data).toHaveLength(2));

    const { result: addHook } = renderHook(() => useAddServiceClient(), { wrapper });
    await act(async () => {
      await addHook.current.mutateAsync({ clientId: 'mike', displayName: 'Mike' });
    });
    expect(
      queryClient.getQueryData<ReturnType<typeof serviceClient>[]>(registryKeys.list)?.map((c) => c.clientId),
    ).toEqual(['alpha', 'mike', 'zulu']);

    const { result: toggleHook } = renderHook(() => useSetServiceClientEnabled(), { wrapper });
    await act(async () => {
      await toggleHook.current.mutateAsync({ clientId: 'mike', enabled: false });
    });
    expect(api.clients.find((c) => c.clientId === 'mike')?.enabled).toBe(false);
    await act(async () => {
      await toggleHook.current.mutateAsync({ clientId: 'mike', enabled: true });
    });
    expect(api.clients.find((c) => c.clientId === 'mike')?.enabled).toBe(true);

    await act(async () => {
      await removeHook.current.mutateAsync('mike');
    });
    expect(
      queryClient.getQueryData<ReturnType<typeof serviceClient>[]>(registryKeys.list)?.map((c) => c.clientId),
    ).toEqual(['alpha', 'zulu']);

    const { result: refreshHook } = renderHook(() => useRefreshRegistry(), { wrapper });
    act(() => refreshHook.current());

    // History pagination (nextBefore !== null and nextBefore === null on line 32)
    const { result: historyHook } = renderHook(() => useRegistryHistory(), { wrapper });
    await waitFor(() => expect(historyHook.current.isSuccess).toBe(true));
    expect(historyHook.current.hasNextPage).toBe(false);
  });

  it('validates service-clients API response shapes and history cursor (lines 56, 69, 76)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    try {
      const validEvent = {
        id: 1,
        clientId: 'alpha',
        action: 'added',
        actor: { principalId: '1', name: 'Ada' },
        createdAt: '2026-11-10T00:00:00Z',
      };
      const validClient = serviceClient('alpha');

      fetchMock.mockResolvedValueOnce(Response.json({ events: [validEvent], nextBefore: 42 }));
      await expect(fetchHistory(42)).resolves.toEqual({ events: [validEvent], nextBefore: 42 });

      const invalidResponses: [() => Promise<unknown>, unknown][] = [
        [() => listServiceClients(), null],
        [() => listServiceClients(), [null]],
        ...[{ clientId: 123 }, { displayName: 123 }, { enabled: 'yes' }, { createdAt: 123 }, { updatedAt: 123 }].map(
          (override): [() => Promise<unknown>, unknown] => [
            () => addServiceClient({ clientId: 'alpha', displayName: 'Alpha' }),
            { ...validClient, ...override },
          ],
        ),
        [() => setServiceClientEnabled('alpha', true), 'bad'],
        [() => fetchHistory(), null],
        [() => fetchHistory(), { events: 'bad', nextBefore: null }],
        [() => fetchHistory(), { events: [validEvent], nextBefore: 'bad' }],
        [() => fetchHistory(), { events: [null], nextBefore: null }],
        [() => fetchHistory(), { events: [{ actor: null }], nextBefore: null }],
        ...[
          { id: '1' },
          { clientId: 123 },
          { action: 'unknown' },
          { actor: { principalId: 123, name: 'Ada' } },
          { actor: { principalId: '1', name: 123 } },
          { createdAt: 123 },
        ].map((override): [() => Promise<unknown>, unknown] => [
          () => fetchHistory(),
          { events: [{ ...validEvent, ...override }], nextBefore: null },
        ]),
      ];

      for (const [, body] of invalidResponses) fetchMock.mockResolvedValueOnce(Response.json(body));
      await Promise.all(
        invalidResponses.map(([call]) => expect(call()).rejects.toThrow('console-api request failed (unexpected)')),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('validates service-clients API response shapes and history cursor (lines 56, 69, 76)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    try {
      const validEvent = {
        id: 1,
        clientId: 'alpha',
        action: 'added',
        actor: { principalId: '1', name: 'Ada' },
        createdAt: '2026-11-10T00:00:00Z',
      };
      const validClient = serviceClient('alpha');

      fetchMock.mockResolvedValueOnce(Response.json({ events: [validEvent], nextBefore: 42 }));
      await expect(fetchHistory(42)).resolves.toEqual({ events: [validEvent], nextBefore: 42 });

      const invalidResponses: [() => Promise<unknown>, unknown][] = [
        [() => listServiceClients(), null],
        [() => listServiceClients(), [null]],
        ...[{ clientId: 123 }, { displayName: 123 }, { enabled: 'yes' }, { createdAt: 123 }, { updatedAt: 123 }].map(
          (override): [() => Promise<unknown>, unknown] => [
            () => addServiceClient({ clientId: 'alpha', displayName: 'Alpha' }),
            { ...validClient, ...override },
          ],
        ),
        [() => setServiceClientEnabled('alpha', true), 'bad'],
        [() => fetchHistory(), null],
        [() => fetchHistory(), { events: 'bad', nextBefore: null }],
        [() => fetchHistory(), { events: [validEvent], nextBefore: 'bad' }],
        [() => fetchHistory(), { events: [null], nextBefore: null }],
        [() => fetchHistory(), { events: [{ actor: null }], nextBefore: null }],
        ...[
          { id: '1' },
          { clientId: 123 },
          { action: 'unknown' },
          { actor: { principalId: 123, name: 'Ada' } },
          { actor: { principalId: '1', name: 123 } },
          { createdAt: 123 },
        ].map((override): [() => Promise<unknown>, unknown] => [
          () => fetchHistory(),
          { events: [{ ...validEvent, ...override }], nextBefore: null },
        ]),
      ];

      for (const [, body] of invalidResponses) fetchMock.mockResolvedValueOnce(Response.json(body));
      await Promise.all(
        invalidResponses.map(([call]) => expect(call()).rejects.toThrow('console-api request failed (unexpected)')),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
});
