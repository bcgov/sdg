import { vi } from 'vitest';

import type { InboxItem } from '../types.js';
import { fakeFetch, json, streamBody, type RecordedRequest, type StreamBody } from './fake-transport.js';

export const notificationsUrl = '/api/v1/notifications';

/** An unread item `n`, created `minutesAgo` minutes before now. */
export const inboxItem = (n: number, overrides: Partial<InboxItem> = {}, minutesAgo = 5): InboxItem => ({
  id: `item-${n}`,
  notificationId: `notification-${n}`,
  title: `Notification ${n}`,
  excerpt: `Excerpt ${n}`,
  readAt: null,
  createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  ...overrides,
});

export interface InboxBackend {
  state: { unread: number; items: InboxItem[]; answers: Map<string, number> };
  requests: RecordedRequest[];
  count: (path: string) => number;
  /** Sends `changed` on the open stream. */
  changed: () => void;
}

/** Stubs `fetch` with a notifications source holding `items`; the unread count follows their read state. */
export function stubInbox(
  items: InboxItem[],
  unread = items.filter(({ readAt }) => readAt === null).length,
): InboxBackend {
  const state = { unread, items, answers: new Map<string, number>() };
  const bodies: StreamBody[] = [];
  const transport = fakeFetch(notificationsUrl, (request) => {
    const status = state.answers.get(request.path);
    if (status) return new Response(null, { status });
    if (request.path === 'inbox/stream') {
      const body = streamBody();
      bodies.push(body);
      return body.response;
    }
    if (request.path === 'inbox/unread-count') return json({ unread: state.unread });
    if (request.path.startsWith('inbox?')) return json({ items: state.items, nextCursor: null });
    if (request.path === 'inbox/read-all') {
      state.items = state.items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() }));
      state.unread = 0;
      return new Response(null, { status: 204 });
    }
    const read = state.items.find(({ id }) => request.path === `inbox/${id}/read`);
    if (!read) return new Response(null, { status: 404 });
    if (read.readAt === null) state.unread -= 1;
    read.readAt ??= new Date().toISOString();
    return json(read);
  });
  vi.stubGlobal('fetch', transport.fetch);
  return {
    state,
    requests: transport.requests,
    count: (path) => transport.requests.filter((request) => request.path === path).length,
    changed: () => bodies.at(-1)?.push('event: changed\ndata: 1\n\n'),
  };
}
