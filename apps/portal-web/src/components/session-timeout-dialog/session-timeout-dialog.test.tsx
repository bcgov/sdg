import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WARNING_LEAD_MS } from '.';
import { App } from '../../app';
import { KEEP_ALIVE_PATH } from '../../auth/keep-alive';
import { SESSION_CHANNEL } from '../../auth/session-channel';
import { currentUserQueryKey } from '../../auth/use-current-user';
import { createAppRouter } from '../../router';

vi.mock('../devtools', () => ({ Devtools: () => null }));

const MINUTE = 60_000;
const user = { id: 'p-1', name: 'Ada Lovelace', email: 'ada@example.com' };
const profile = { name: 'Ada Lovelace', email: null, phoneNumber: null, birthdate: null, gender: null, address: null };

let keepAlive: () => Response;
const fetchMock = vi.fn<typeof fetch>((input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url === KEEP_ALIVE_PATH) return Promise.resolve(keepAlive());
  if (url === '/api/auth/me') return Promise.resolve(Response.json(user));
  if (url === '/api/v1/portal/profile') return Promise.resolve(Response.json(profile));
  if (url === '/api/auth/logout') return Promise.resolve(Response.json({ redirectUrl: 'https://idp.test/logout' }));
  return Promise.resolve(Response.json({ statusCode: 404 }, { status: 404 }));
});
const posts = (path: string) => fetchMock.mock.calls.filter(([url, init]) => url === path && init?.method === 'POST');
const deadlineIn = (ms: number) => () => Response.json({ idleExpiresAt: Date.now() + ms });

/** Lets requests and React Query settle; only setInterval and Date are faked, so waitFor can't poll. */
async function flush(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}

async function advance(ms: number): Promise<void> {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

async function renderAt(path: string) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(currentUserQueryKey, user);
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [path] }) });
  // jsdom can't leave the page: record full-page navigations (the login redirect) instead of performing them.
  const documentNavigations: string[] = [];
  const original = router.navigate.bind(router);
  vi.spyOn(router, 'navigate').mockImplementation(async (options) => {
    if (options.reloadDocument && options.href) {
      documentNavigations.push(options.href);
      return;
    }
    return original(options);
  });
  render(<App queryClient={queryClient} router={router} />);
  await flush();
  return { queryClient, documentNavigations };
}

const dialog = () => screen.queryByRole('alertdialog', { name: 'You’ll be signed out soon' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(Date.parse('2026-11-26T12:00:00Z'));
  keepAlive = deadlineIn(30 * MINUTE);
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SessionTimeoutDialog', () => {
  it(`warns an idle resident ${WARNING_LEAD_MS / MINUTE} minutes before the session lapses, and not before`, async () => {
    await renderAt('/settings');
    await advance(27 * MINUTE);
    expect(dialog()).not.toBeInTheDocument();

    await advance(MINUTE + 15_000);
    expect(dialog()).toBeInTheDocument();
    expect(dialog()).toHaveTextContent('you’ll be signed out in 2 minutes');
    expect(dialog()?.contains(document.activeElement)).toBe(true);
  });

  it('keeps the resident signed in with Stay signed in, which renews the session and closes the warning', async () => {
    await renderAt('/settings');
    await advance(28 * MINUTE + 15_000);
    expect(dialog()).toBeInTheDocument();
    const before = posts(KEEP_ALIVE_PATH).length;

    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    await flush();
    expect(posts(KEEP_ALIVE_PATH)).toHaveLength(before + 1);
    expect(dialog()).not.toBeInTheDocument();
  });

  it('signs the resident out with Sign out', async () => {
    const { queryClient } = await renderAt('/settings');
    await advance(28 * MINUTE + 15_000);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await flush();
    expect(posts('/api/auth/logout')).toHaveLength(1);
    expect(queryClient.getQueryData(currentUserQueryKey)).toBeNull();
  });

  it('sends a resident whose session lapsed on Settings to sign in, returning to Settings', async () => {
    const { documentNavigations } = await renderAt('/settings');
    keepAlive = () => Response.json({ statusCode: 401 }, { status: 401 });

    await advance(30 * MINUTE + 15_000);
    expect(documentNavigations).toEqual(['/api/auth/login?returnTo=%2Fsettings']);
    expect(dialog()).not.toBeInTheDocument();
  });

  it('closes the warning without signing out when the final check finds the session renewed elsewhere', async () => {
    const { documentNavigations } = await renderAt('/settings');
    await advance(28 * MINUTE + 15_000);
    expect(dialog()).toBeInTheDocument();

    keepAlive = deadlineIn(25 * MINUTE);
    await advance(2 * MINUTE);
    expect(dialog()).not.toBeInTheDocument();
    expect(documentNavigations).toEqual([]);
  });

  it('closes the warning at once when another tab renews, without asking portal-api', async () => {
    await renderAt('/settings');
    await advance(28 * MINUTE + 15_000);
    expect(dialog()).toBeInTheDocument();
    const before = posts(KEEP_ALIVE_PATH).length;

    const otherTab = new BroadcastChannel(SESSION_CHANNEL);
    try {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel.postMessage has no targetOrigin: a channel only reaches its own origin.
      otherTab.postMessage({ type: 'renewed', idleExpiresAt: Date.now() + 30 * MINUTE });
      await flush();
    } finally {
      otherTab.close();
    }
    expect(dialog()).not.toBeInTheDocument();
    expect(posts(KEEP_ALIVE_PATH)).toHaveLength(before);
  });

  it('shows no warning to a signed-out visitor', async () => {
    const { queryClient } = await renderAt('/');
    act(() => {
      queryClient.setQueryData(currentUserQueryKey, null);
    });
    await advance(29 * MINUTE);
    expect(dialog()).not.toBeInTheDocument();
  });
});
