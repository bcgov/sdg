import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { fakeConsoleApi, nestError, serviceClient } from '../../test-support/fake-console-api';
import { useRegistryActions } from './use-registry-actions';

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useRegistryActions', () => {
  it('Should ignore toggle while pending, toggle both directions, handle 404/503 errors, and dismiss notices', async () => {
    const api = fakeConsoleApi({
      clients: [serviceClient('alpha', { enabled: true }), serviceClient('beta', { enabled: false })],
    });
    const onListChanged = vi.fn<() => void>();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRegistryActions(onListChanged), { wrapper: createWrapper(queryClient) });

    // Hold the disable request in-flight so calling toggle() again hits `if (isPending) return` (line 45)
    let release!: () => void;
    api.refuseNext(
      'POST',
      '/api/v1/console/service-clients/alpha/disable',
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(Response.json(serviceClient('alpha', { enabled: false })));
        }),
    );

    act(() => {
      result.current.toggle(serviceClient('alpha', { enabled: true }));
    });
    await waitFor(() => expect(result.current.busyClientId).toBe('alpha'));

    // Second toggle while pending is ignored
    act(() => {
      result.current.toggle(serviceClient('beta', { enabled: false }));
    });
    expect(api.callsTo('POST', '/api/v1/console/service-clients/beta/enable')).toHaveLength(0);

    release();
    await waitFor(() => expect(result.current.status).toBe('Disabled alpha.'));

    // Toggle disabled -> enabled (line 50 true branch)
    act(() => {
      result.current.toggle(serviceClient('beta', { enabled: false }));
    });
    await waitFor(() => expect(result.current.status).toBe('Enabled beta.'));

    // 503 failure -> notice with retry, then dismiss
    api.refuseNext('POST', '/api/v1/console/service-clients/beta/disable', () =>
      nestError(503, 'Unavailable', 'Service Unavailable'),
    );
    act(() => {
      result.current.toggle(serviceClient('beta', { enabled: true }));
    });
    await waitFor(() => expect(result.current.notice).not.toBeNull());
    expect(onListChanged).not.toHaveBeenCalled();

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.notice).toBeNull();

    // 404 failure -> calls onListChanged
    api.refuseNext('POST', '/api/v1/console/service-clients/beta/disable', () =>
      nestError(404, 'Not found', 'Not Found'),
    );
    act(() => {
      result.current.toggle(serviceClient('beta', { enabled: true }));
    });
    await waitFor(() => expect(onListChanged).toHaveBeenCalledTimes(1));
  });

  it('Should ignore confirmRemove when removing is null, support cancel, and handle removal success and failure', async () => {
    const api = fakeConsoleApi({ clients: [serviceClient('alpha')] });
    const onListChanged = vi.fn<() => void>();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRegistryActions(onListChanged), { wrapper: createWrapper(queryClient) });

    // No-op when removing === null (line 65)
    act(() => {
      result.current.confirmRemove();
    });
    expect(api.callsTo('DELETE', '/api/v1/console/service-clients/alpha')).toHaveLength(0);

    // askRemove + cancelRemove
    act(() => {
      result.current.askRemove(serviceClient('alpha'));
    });
    expect(result.current.removing?.clientId).toBe('alpha');
    act(() => {
      result.current.cancelRemove();
    });
    expect(result.current.removing).toBeNull();

    // askRemove + confirmRemove failure (503) + retry success
    api.refuseNext('DELETE', '/api/v1/console/service-clients/alpha', () =>
      nestError(503, 'Unavailable', 'Service Unavailable'),
    );
    act(() => {
      result.current.askRemove(serviceClient('alpha'));
    });
    act(() => {
      result.current.confirmRemove();
    });
    await waitFor(() => expect(result.current.notice).not.toBeNull());
    expect(result.current.removing).toBeNull();

    act(() => {
      result.current.notice?.retry?.();
    });
    await waitFor(() => expect(result.current.status).toBe('Removed alpha.'));
    expect(onListChanged).toHaveBeenCalledTimes(1);
  });
});
