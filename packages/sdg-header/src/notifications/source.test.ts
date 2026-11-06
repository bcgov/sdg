import { describe, expect, it, vi } from 'vitest';

import { fakeFetch, json } from '../test-support/fake-transport.js';
import type { AccessTokenRequest } from '../types.js';
import { NotificationsSource, SourceError, TokenUnavailableError } from './source.js';

const relayUrl = '/api/v1/notifications';
const directUrl = 'https://notify.sdg.localhost/api/v1/me';
const item = {
  id: '00000000-0000-4000-8000-000000000001',
  notificationId: '00000000-0000-4000-8000-0000000000a1',
  title: 'Your permit is ready',
  excerpt: 'Pick it up any time.',
  readAt: null,
  createdAt: '2026-11-05T16:00:00.000Z',
};

function answer(path: string): Response {
  if (path === 'inbox/unread-count') return json({ unread: 3 });
  if (path.startsWith('inbox?')) return json({ items: [item], nextCursor: null });
  if (path.endsWith('/read')) return json({ ...item, readAt: '2026-11-05T16:05:00.000Z' });
  return json({});
}

describe('NotificationsSource', () => {
  describe('relay mode', () => {
    it('loads the count and the newest 20 items with same-origin credentials, no Authorization and sdg-background: 1', async () => {
      const transport = fakeFetch(relayUrl, (request) => answer(request.path));
      const source = new NotificationsSource({ url: relayUrl, fetch: transport.fetch });

      await expect(source.unreadCount()).resolves.toBe(3);
      await expect(source.latest()).resolves.toEqual([item]);

      expect(transport.requests.map(({ path }) => path)).toEqual(['inbox/unread-count', 'inbox?limit=20']);
      for (const request of transport.requests) {
        expect(request.method).toBe('GET');
        expect(request.credentials).toBe('same-origin');
        expect(request.headers['sdg-background']).toBe('1');
        expect(request.headers.authorization).toBeUndefined();
      }
    });

    it('marks one item read and marks all read as user actions, without sdg-background', async () => {
      const transport = fakeFetch(relayUrl, (request) => answer(request.path));
      const source = new NotificationsSource({ url: `${relayUrl}/`, fetch: transport.fetch });

      await expect(source.markRead(item.id)).resolves.toMatchObject({
        id: item.id,
        readAt: '2026-11-05T16:05:00.000Z',
      });
      await source.markAllRead();

      expect(transport.requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
        `POST ${relayUrl}/inbox/${item.id}/read`,
        `POST ${relayUrl}/inbox/read-all`,
      ]);
      for (const request of transport.requests) {
        expect(request.credentials).toBe('same-origin');
        expect(request.headers['sdg-background']).toBeUndefined();
      }
    });

    it('opens the stream as a background request and rejects a non-2xx answer with its status', async () => {
      const transport = fakeFetch(relayUrl, () => new Response(null, { status: 401 }));
      const source = new NotificationsSource({ url: relayUrl, fetch: transport.fetch });

      const error = await source.stream(new AbortController().signal).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SourceError);
      expect(error).toMatchObject({ status: 401 });
      expect(transport.requests[0]).toMatchObject({ path: 'inbox/stream', method: 'GET' });
      expect(transport.requests[0]?.headers['sdg-background']).toBe('1');
      expect(transport.requests[0]?.headers.accept).toBe('text/event-stream');
    });
  });

  describe('direct mode', () => {
    it('asks accessTokenFn with background: true for loads and false for user actions, and sends the token', async () => {
      const transport = fakeFetch(directUrl, (request) => answer(request.path));
      const accessTokenFn = vi.fn<(request: AccessTokenRequest) => Promise<string>>(async () => 'token-1');
      const source = new NotificationsSource({ url: directUrl, accessTokenFn, fetch: transport.fetch });

      await source.unreadCount();
      await source.markRead(item.id);

      expect(accessTokenFn.mock.calls).toEqual([[{ background: true }], [{ background: false }]]);
      for (const request of transport.requests) {
        expect(request.headers.authorization).toBe('Bearer token-1');
        expect(request.credentials).toBe('omit');
      }
      expect(transport.requests[0]?.headers['sdg-background']).toBe('1');
      expect(transport.requests[1]?.headers['sdg-background']).toBeUndefined();
    });

    it('sends nothing when accessTokenFn returns null', async () => {
      const transport = fakeFetch(directUrl, (request) => answer(request.path));
      const source = new NotificationsSource({ url: directUrl, accessTokenFn: () => null, fetch: transport.fetch });

      await expect(source.unreadCount()).rejects.toBeInstanceOf(TokenUnavailableError);
      expect(transport.requests).toHaveLength(0);
    });
  });
});
