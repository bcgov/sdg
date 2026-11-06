import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeChannels, FakeLocks } from '../test-support/fake-browser.js';
import { fakeFetch, json, streamBody, type StreamBody } from '../test-support/fake-transport.js';
import type { AccessTokenFn, InboxItem } from '../types.js';
import { NotificationsController, type NotificationsEnvironment } from './notifications-controller.js';

const url = '/api/v1/notifications';
const item = (n: number, readAt: string | null = null): InboxItem => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  notificationId: `00000000-0000-4000-8000-0000000000a${n}`,
  title: `Notification ${n}`,
  excerpt: null,
  readAt,
  createdAt: '2026-11-05T16:00:00.000Z',
});

/** The fake notifications backend every controller in a test talks to. */
function backend() {
  const state = { unread: 2, items: [item(1), item(2)], answers: new Map<string, number>() };
  const bodies: StreamBody[] = [];
  const transport = fakeFetch(url, (request) => {
    const status = state.answers.get(request.path);
    if (status) return new Response(null, { status });
    if (request.path === 'inbox/stream') {
      const body = streamBody();
      bodies.push(body);
      return body.response;
    }
    if (request.path === 'inbox/unread-count') return json({ unread: state.unread });
    if (request.path.startsWith('inbox?')) return json({ items: state.items, nextCursor: null });
    if (request.path.endsWith('/read')) return json({ ...item(1), readAt: '2026-11-05T16:05:00.000Z' });
    return new Response(null, { status: 204 });
  });
  const count = (path: string) => transport.requests.filter((request) => request.path === path).length;
  return { ...transport, state, bodies, count, changed: () => bodies.at(-1)?.push('event: changed\ndata: 1\n\n') };
}

/** A stand-in for the element: the controller only needs the ReactiveControllerHost interface. */
function fakeHost() {
  const controllers: ReactiveController[] = [];
  const host: ReactiveControllerHost = {
    addController: (controller) => controllers.push(controller),
    removeController: () => undefined,
    requestUpdate: vi.fn<() => void>(),
    updateComplete: Promise.resolve(true),
  };
  return {
    host,
    connect: () => controllers.forEach((controller) => controller.hostConnected?.()),
    disconnect: () => controllers.forEach((controller) => controller.hostDisconnected?.()),
  };
}

function tab(
  api: ReturnType<typeof backend>,
  environment: NotificationsEnvironment = {},
  accessTokenFn?: AccessTokenFn,
) {
  const { host, connect, disconnect } = fakeHost();
  const notificationsChangedFn = vi.fn<() => void>();
  const controller = new NotificationsController(host, { fetch: api.fetch, ...environment });
  controller.configure({ url, signedIn: true, accessTokenFn, notificationsChangedFn });
  connect();
  return { controller, notificationsChangedFn, disconnect };
}

const settle = () => vi.advanceTimersByTimeAsync(0);
const debounce = () => vi.advanceTimersByTimeAsync(300);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('NotificationsController', () => {
  it('loads the unread count and newest items, and holds its own stream where Web Locks are missing', async () => {
    const api = backend();
    const { controller, notificationsChangedFn, disconnect } = tab(api);
    expect(controller.status).toBe('loading');
    await settle();
    expect(controller).toMatchObject({ status: 'ready', unread: 2, items: [item(1), item(2)] });
    expect(api.count('inbox/stream')).toBe(1);
    expect(notificationsChangedFn).not.toHaveBeenCalled();
    disconnect();
  });

  it('shares one stream between two tabs, and a changed makes both refetch and tell the host', async () => {
    const api = backend();
    const shared = { locks: new FakeLocks(), createChannel: new FakeChannels().create };
    const first = tab(api, shared);
    const second = tab(api, shared);
    await debounce();
    expect(api.count('inbox/stream')).toBe(1);

    api.state.unread = 3;
    api.changed();
    await debounce();
    expect(first.controller.unread).toBe(3);
    expect(second.controller.unread).toBe(3);
    expect(first.notificationsChangedFn).toHaveBeenCalledOnce();
    expect(second.notificationsChangedFn).toHaveBeenCalledOnce();
    first.disconnect();
    second.disconnect();
  });

  it('tells the host after a reconnect, so a host page catches up on changes missed while it was down (R26, R33)', async () => {
    const api = backend();
    const { controller, notificationsChangedFn, disconnect } = tab(api);
    await debounce();
    expect(notificationsChangedFn).not.toHaveBeenCalled();

    api.state.unread = 5;
    api.bodies.at(-1)?.end();
    await vi.advanceTimersByTimeAsync(2_500);
    await debounce();
    expect(api.count('inbox/stream')).toBe(2);
    expect(controller.unread).toBe(5);
    expect(notificationsChangedFn).toHaveBeenCalledOnce();
    disconnect();
  });

  it('refetches once for five changed events within 100 ms', async () => {
    const api = backend();
    const { disconnect } = tab(api);
    await debounce();
    const before = api.count('inbox/unread-count');
    for (let event = 0; event < 5; event += 1) {
      api.changed();
      // oxlint-disable-next-line no-await-in-loop -- the events are spread over 100 ms.
      await vi.advanceTimersByTimeAsync(20);
    }
    await debounce();
    expect(api.count('inbox/unread-count')).toBe(before + 1);
    disconnect();
  });

  it('refetches as a background request when the window regains focus', async () => {
    const api = backend();
    const { controller, disconnect } = tab(api);
    await debounce();
    api.state.unread = 5;
    window.dispatchEvent(new Event('focus'));
    await debounce();
    expect(controller.unread).toBe(5);
    expect(api.requests.at(-1)?.headers['sdg-background']).toBe('1');
    disconnect();
  });

  it('sets status unavailable when the stream answers 404', async () => {
    const api = backend();
    api.state.answers.set('inbox/stream', 404);
    const { controller, disconnect } = tab(api);
    await debounce();
    expect(controller.status).toBe('unavailable');
    disconnect();
  });

  it('calls notificationsChangedFn and stops the stream when the count load answers 401', async () => {
    const api = backend();
    api.state.answers.set('inbox/unread-count', 401);
    const { notificationsChangedFn, disconnect } = tab(api);
    await debounce();
    expect(notificationsChangedFn).toHaveBeenCalledOnce();
    const stream = api.requests.find(({ path }) => path === 'inbox/stream');
    expect(stream?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.count('inbox/stream')).toBe(1);
    disconnect();
  });

  describe('marking read', () => {
    it('marks one item and all items read, updating the state and telling the host each time', async () => {
      const api = backend();
      const { controller, notificationsChangedFn, disconnect } = tab(api);
      await debounce();

      await controller.markRead(item(1).id);
      expect(controller.unread).toBe(1);
      expect(controller.items[0]?.readAt).toBe('2026-11-05T16:05:00.000Z');
      expect(notificationsChangedFn).toHaveBeenCalledTimes(1);

      await controller.markAllRead();
      expect(controller.unread).toBe(0);
      expect(controller.items.every(({ readAt }) => readAt !== null)).toBe(true);
      expect(notificationsChangedFn).toHaveBeenCalledTimes(2);
      disconnect();
    });

    it('leaves the count and read state as they were when mark-all or mark-read fails', async () => {
      const api = backend();
      api.state.answers.set('inbox/read-all', 500);
      api.state.answers.set(`inbox/${item(1).id}/read`, 500);
      const { controller, notificationsChangedFn, disconnect } = tab(api);
      await debounce();

      await expect(controller.markAllRead()).rejects.toMatchObject({ status: 500 });
      await expect(controller.markRead(item(1).id)).rejects.toMatchObject({ status: 500 });
      expect(controller).toMatchObject({ unread: 2, items: [item(1), item(2)] });
      expect(notificationsChangedFn).not.toHaveBeenCalled();
      disconnect();
    });
  });

  describe('direct mode', () => {
    it('sends nothing while accessTokenFn returns null, then retries with background: false on a pointer event', async () => {
      const api = backend();
      let token: string | null = null;
      const accessTokenFn = vi.fn<AccessTokenFn>(() => token);
      const { controller, disconnect } = tab(api, {}, accessTokenFn);
      await debounce();
      window.dispatchEvent(new Event('focus'));
      await debounce();
      expect(api.requests).toHaveLength(0);
      expect(accessTokenFn.mock.calls.every(([request]) => request.background)).toBe(true);

      token = 'token-1';
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await debounce();
      expect(accessTokenFn).toHaveBeenCalledWith({ background: false });
      expect(controller).toMatchObject({ status: 'ready', unread: 2 });
      expect(api.count('inbox/stream')).toBe(1);
      expect(api.requests[0]?.headers.authorization).toBe('Bearer token-1');
      disconnect();
    });
  });
});
