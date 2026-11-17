import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FlagProvider, useFlag } from './flag-provider';

const fetchMock = vi.fn<typeof fetch>();

/** Retries on and quick, so a missing `retry: false` would show up as extra requests within the test. */
function renderInProvider<T>(hook: () => T) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <FlagProvider>{children}</FlagProvider>
    </QueryClientProvider>
  );
  return renderHook(hook, { wrapper });
}

const renderFlag = (key: string) => renderInProvider(() => useFlag(key));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

describe('FlagProvider and useFlag', () => {
  it('Should report loading and not enabled while the flags request is pending (R9)', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    const { result } = renderFlag('x');
    expect(result.current).toEqual({ isLoading: true, isEnabled: false });
  });

  it('Should enable a listed flag and leave an unlisted one off (R10)', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(Response.json({ x: true })));
    const { result } = renderInProvider(() => ({ x: useFlag('x'), y: useFlag('y') }));
    await waitFor(() => expect(result.current.x.isLoading).toBe(false));
    expect(result.current.x).toEqual({ isLoading: false, isEnabled: true });
    expect(result.current.y).toEqual({ isLoading: false, isEnabled: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a 401', () => Response.json({ statusCode: 401 }, { status: 401 })],
    ['a 503', () => Response.json({ statusCode: 503 }, { status: 503 })],
    ['a non-JSON body', () => new Response('<html>oops</html>', { headers: { 'content-type': 'text/html' } })],
    ['{ "x": "yes" }', () => Response.json({ x: 'yes' })],
  ])('Should settle to off with one request and no retry on %s (R7, AE8)', async (_label, respond) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockImplementation(() => Promise.resolve(respond()));
    const { result } = renderFlag('x');
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toEqual({ isLoading: false, isEnabled: false });
    // Give a retry (delay 0) the chance to fire before counting requests.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('Should not refetch on window focus or reconnect (R8)', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(Response.json({ x: true })));
    const { result } = renderFlag('x');
    await waitFor(() => expect(result.current.isEnabled).toBe(true));
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Should throw when useFlag is used outside a FlagProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useFlag('x'))).toThrow('useFlag must be used inside <FlagProvider>');
  });
});
