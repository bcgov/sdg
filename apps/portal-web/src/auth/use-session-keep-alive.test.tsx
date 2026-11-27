import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KEEP_ALIVE_PATH } from './keep-alive';
import { SESSION_CHANNEL } from './session-channel';
import { IDLE_FALLBACK_MS, KEEP_ALIVE_INTERVAL_MS, useSessionKeepAlive } from './use-session-keep-alive';

const DEADLINE = Date.parse('2026-11-26T12:30:00Z');

let answer: () => Response;
const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(answer()));
const keepAlives = () =>
  fetchMock.mock.calls.filter(([url, init]) => url === KEEP_ALIVE_PATH && init?.method === 'POST');

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

function renderKeepAlive(signedIn = true) {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(({ on }) => useSessionKeepAlive(on), { wrapper, initialProps: { on: signedIn } });
}

/**
 * Lets requests and React Query's notifications settle. Only setInterval and Date are faked (so React Query's
 * setTimeout scheduling runs), which also means Testing Library's waitFor, polling with setInterval, can't be used.
 */
async function flush(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
}

/** Moves the clock and the interval timer on, then lets any request settle. */
async function advance(ms: number): Promise<void> {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

/** One interval with activity halfway through, then the tick. */
async function activeInterval(): Promise<void> {
  await advance(KEEP_ALIVE_INTERVAL_MS / 2);
  fireEvent.pointerDown(window);
  fireEvent.scroll(window);
  await advance(KEEP_ALIVE_INTERVAL_MS / 2);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(Date.parse('2026-11-26T12:00:00Z'));
  answer = () => Response.json({ idleExpiresAt: DEADLINE });
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  setVisibility('visible');
  heard = [];
  otherTab = new BroadcastChannel(SESSION_CHANNEL);
  otherTab.addEventListener('message', (event: MessageEvent<unknown>) => heard.push(event.data));
});

/** Another tab on the same origin. */
let otherTab: BroadcastChannel;
let heard: unknown[];

function fromOtherTab(data: unknown): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel.postMessage has no targetOrigin: a channel only reaches its own origin.
  otherTab.postMessage(data);
}

afterEach(() => {
  vi.useRealTimers();
  otherTab.close();
});

describe('useSessionKeepAlive', () => {
  it('renews once on sign-in and reports the idle deadline portal-api gives', async () => {
    const { result } = renderKeepAlive();
    await flush();
    expect(result.current.idleExpiresAt).toBe(DEADLINE);
    expect(keepAlives()).toHaveLength(1);
  });

  it('never renews for a signed-out visitor', async () => {
    const { result } = renderKeepAlive(false);
    fireEvent.keyDown(window);
    await advance(KEEP_ALIVE_INTERVAL_MS * 3);
    expect(keepAlives()).toHaveLength(0);
    expect(result.current.idleExpiresAt).toBeNull();
  });

  it('does not renew an idle tab', async () => {
    renderKeepAlive();
    await flush();
    expect(keepAlives()).toHaveLength(1);
    await advance(KEEP_ALIVE_INTERVAL_MS * 5);
    expect(keepAlives()).toHaveLength(1);
  });

  it('renews once per interval while the resident is active', async () => {
    renderKeepAlive();
    await flush();
    expect(keepAlives()).toHaveLength(1);
    await activeInterval();
    await activeInterval();
    await activeInterval();
    expect(keepAlives()).toHaveLength(4);
  });

  it('does not renew a hidden tab, even after activity', async () => {
    renderKeepAlive();
    await flush();
    expect(keepAlives()).toHaveLength(1);
    fireEvent.keyDown(window);
    setVisibility('hidden');
    await advance(KEEP_ALIVE_INTERVAL_MS * 2);
    expect(keepAlives()).toHaveLength(1);
  });

  it('renews at once when the resident comes back after a pause longer than the interval', async () => {
    renderKeepAlive();
    await flush();
    expect(keepAlives()).toHaveLength(1);
    await advance(20 * 60_000);
    fireEvent.pointerDown(window);
    await flush();
    expect(keepAlives()).toHaveLength(2);
  });

  it('assumes the 30-minute idle limit when portal-api reports none', async () => {
    answer = () => Response.json({ idleExpiresAt: null });
    const { result } = renderKeepAlive();
    await flush();
    expect(result.current.idleExpiresAt).toBe(Date.now() + IDLE_FALLBACK_MS);
  });

  it('stops renewing and forgets the deadline on sign-out', async () => {
    const { result, rerender } = renderKeepAlive();
    await flush();
    expect(result.current.idleExpiresAt).toBe(DEADLINE);
    rerender({ on: false });
    expect(result.current.idleExpiresAt).toBeNull();
    fireEvent.keyDown(window);
    await advance(KEEP_ALIVE_INTERVAL_MS * 2);
    expect(keepAlives()).toHaveLength(1);
  });

  describe('across tabs', () => {
    it('tells the other tabs the deadline each renewal answers', async () => {
      renderKeepAlive();
      await flush();
      expect(heard).toEqual([{ type: 'renewed', idleExpiresAt: DEADLINE }]);
    });

    it("moves this tab's deadline when another tab renews, without renewing itself", async () => {
      const { result } = renderKeepAlive();
      await flush();
      fromOtherTab({ type: 'renewed', idleExpiresAt: DEADLINE + 10 * 60_000 });
      await flush();
      expect(result.current.idleExpiresAt).toBe(DEADLINE + 10 * 60_000);
      expect(keepAlives()).toHaveLength(1);
    });

    it('keeps the later deadline when another tab reports an earlier one', async () => {
      const { result } = renderKeepAlive();
      await flush();
      fromOtherTab({ type: 'renewed', idleExpiresAt: DEADLINE - 60_000 });
      await flush();
      expect(result.current.idleExpiresAt).toBe(DEADLINE);
    });

    it('ignores messages that are not renewals', async () => {
      const { result } = renderKeepAlive();
      await flush();
      fromOtherTab({ type: 'renewed', idleExpiresAt: 'soon' });
      fromOtherTab('hello');
      await flush();
      expect(result.current.idleExpiresAt).toBe(DEADLINE);
    });

    it('stops listening on sign-out', async () => {
      const { result, rerender } = renderKeepAlive();
      await flush();
      rerender({ on: false });
      fromOtherTab({ type: 'renewed', idleExpiresAt: DEADLINE + 60_000 });
      await flush();
      expect(result.current.idleExpiresAt).toBeNull();
    });
  });
});
