import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeChannels, FakeLocks } from '../test-support/fake-browser.js';
import { fakeFetch, streamBody, type StreamBody } from '../test-support/fake-transport.js';
import { LiveConnection, type LiveConnectionOptions, type LiveStatus } from './live-connection.js';
import { NotificationsSource } from './source.js';

const url = '/api/v1/notifications';

/** A transport whose stream requests answer from `answers` in turn: a status code, or an open body. */
function streamTransport() {
  const bodies: StreamBody[] = [];
  const answers: (number | 'open')[] = [];
  const transport = fakeFetch(url, () => {
    const answer = answers.shift() ?? 'open';
    if (answer !== 'open') return new Response(null, { status: answer });
    const body = streamBody();
    bodies.push(body);
    return body.response;
  });
  return {
    ...transport,
    bodies,
    answers,
    streams: () => transport.requests.filter(({ path }) => path === 'inbox/stream'),
  };
}

function connect(fetch: ReturnType<typeof streamTransport>['fetch'], options: Partial<LiveConnectionOptions> = {}) {
  const statuses: LiveStatus[] = [];
  const onChanged = vi.fn<() => void>();
  const onOpen = vi.fn<() => void>();
  const connection = new LiveConnection({
    source: new NotificationsSource({ url, fetch }),
    onChanged,
    onOpen,
    onStatus: (status) => statuses.push(status),
    locks: null,
    createChannel: null,
    ...options,
  });
  connection.start();
  return { connection, statuses, onChanged, onOpen };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LiveConnection', () => {
  it('reports open, then a changed event, from its own stream', async () => {
    const transport = streamTransport();
    const { onOpen, onChanged, statuses, connection } = connect(transport.fetch);
    await vi.advanceTimersByTimeAsync(0);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toBe('connected');

    transport.bodies[0]?.push(': keep-alive\n\nevent: changed\ndata: 1\n\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(onChanged).toHaveBeenCalledOnce();
    connection.stop();
  });

  describe('one stream per browser', () => {
    it('opens one stream between two tabs, and the follower hears its changed and open', async () => {
      const transport = streamTransport();
      const shared = { locks: new FakeLocks(), createChannel: new FakeChannels().create };
      const leader = connect(transport.fetch, shared);
      const follower = connect(transport.fetch, shared);
      await vi.advanceTimersByTimeAsync(0);
      expect(transport.streams()).toHaveLength(1);
      expect(follower.onOpen).toHaveBeenCalledOnce();

      transport.bodies[0]?.push('event: changed\ndata: 1\n\n');
      await vi.advanceTimersByTimeAsync(0);
      expect(leader.onChanged).toHaveBeenCalledOnce();
      expect(follower.onChanged).toHaveBeenCalledOnce();
      leader.connection.stop();
      follower.connection.stop();
    });

    it('hands the stream to the follower when the leader stops', async () => {
      const transport = streamTransport();
      const shared = { locks: new FakeLocks(), createChannel: new FakeChannels().create };
      const leader = connect(transport.fetch, shared);
      const follower = connect(transport.fetch, shared);
      await vi.advanceTimersByTimeAsync(0);

      leader.connection.stop();
      await vi.advanceTimersByTimeAsync(0);
      expect(transport.streams()).toHaveLength(2);
      expect(transport.streams()[0]?.signal?.aborted).toBe(true);
      expect(follower.statuses.at(-1)).toBe('connected');
      follower.connection.stop();
    });
  });

  describe('reconnect rules', () => {
    it('reconnects within 2 seconds after a clean end', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.75);
      const transport = streamTransport();
      const { onOpen, connection } = connect(transport.fetch);
      await vi.advanceTimersByTimeAsync(0);

      transport.bodies[0]?.end();
      await vi.advanceTimersByTimeAsync(1499);
      expect(transport.streams()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(transport.streams()).toHaveLength(2);
      expect(onOpen).toHaveBeenCalledTimes(2);
      connection.stop();
    });

    it('backs off 1, 2, then 4 seconds after 500s, and starts again from 1 second once a stream opens', async () => {
      const transport = streamTransport();
      transport.answers.push(500, 500, 500);
      const { connection } = connect(transport.fetch);
      await vi.advanceTimersByTimeAsync(0);
      const at = [0];
      for (const delay of [1000, 2000, 4000]) {
        // oxlint-disable-next-line no-await-in-loop -- each retry waits for the previous one's backoff.
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(transport.streams()).toHaveLength(at.length);
        // oxlint-disable-next-line no-await-in-loop -- as above.
        await vi.advanceTimersByTimeAsync(1);
        at.push(delay);
        expect(transport.streams()).toHaveLength(at.length);
      }
      expect(transport.bodies).toHaveLength(1);

      transport.answers.push(500);
      transport.bodies[0]?.fail();
      await vi.advanceTimersByTimeAsync(1000);
      expect(transport.streams()).toHaveLength(5);
      connection.stop();
    });

    it('stops on a 401 and reports auth-paused', async () => {
      const transport = streamTransport();
      transport.answers.push(401);
      const { statuses } = connect(transport.fetch);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(transport.streams()).toHaveLength(1);
      expect(statuses.at(-1)).toBe('auth-paused');
    });

    it('stops on a 404 and reports unavailable', async () => {
      const transport = streamTransport();
      transport.answers.push(404);
      const { statuses } = connect(transport.fetch);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(transport.streams()).toHaveLength(1);
      expect(statuses.at(-1)).toBe('unavailable');
    });

    it('stops with token-paused when the token function returns null', async () => {
      const transport = streamTransport();
      const source = new NotificationsSource({ url, fetch: transport.fetch, accessTokenFn: () => null });
      const { statuses } = connect(transport.fetch, { source });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(transport.streams()).toHaveLength(0);
      expect(statuses.at(-1)).toBe('token-paused');
    });
  });
});
