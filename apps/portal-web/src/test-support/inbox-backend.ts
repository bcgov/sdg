import { vi } from 'vitest';

/** An inbox item as portal-api's relay returns it. */
export interface FakeItem {
  id: string;
  notificationId: string;
  type: string;
  title: string | null;
  body: string | null;
  excerpt: string | null;
  actionUrl: string | null;
  language: string;
  readAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

export interface RecordedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
}

const INBOX = '/api/v1/notifications/inbox';
const encoder = new TextEncoder();

/** `count` items, newest first, ids `i-1`… with titles `Notification 1`…. */
export function makeItems(count: number, start = 1): FakeItem[] {
  return Array.from({ length: count }, (_, index) => makeItem(start + index));
}

export function makeItem(n: number, overrides: Partial<FakeItem> = {}): FakeItem {
  return {
    id: `i-${n}`,
    notificationId: `n-${n}`,
    type: 'general',
    title: `Notification ${n}`,
    body: `<p>Body ${n}</p>`,
    excerpt: `Excerpt ${n}`,
    actionUrl: null,
    language: 'en',
    readAt: null,
    acknowledgedAt: null,
    // Newest first: a smaller n is newer.
    createdAt: new Date(Date.UTC(2026, 10, 5, 12, 0, 0) - n * 60_000).toISOString(),
    ...overrides,
  };
}

const requestUrl = (input: string | URL | Request): string => {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
};

const unauthorized = () => Response.json({ statusCode: 401, message: 'Unauthorized' }, { status: 401 });

/**
 * portal-api as the browser sees it: the session, the notifications relay (list, count, one item, read, read-all) and the live
 * stream. Tests change `items`, `signedIn` and `failures` and call `signal()` to send `changed` on open streams.
 */
export class InboxBackend {
  items: FakeItem[];
  signedIn = true;
  /** Status to answer for a request whose `METHOD path?query` starts with the key. */
  readonly failures = new Map<string, number>();
  readonly calls: RecordedCall[] = [];
  readonly fetch = vi.fn<typeof fetch>((input, init) => Promise.resolve(this.#answer(requestUrl(input), init ?? {})));
  readonly #streams = new Set<ReadableStreamDefaultController<Uint8Array>>();

  constructor(items: FakeItem[] = []) {
    this.items = items;
  }

  /** Sends `event: changed` on every open stream, as notification-api does after an inbox write. */
  signal(): void {
    for (const stream of this.#streams) stream.enqueue(encoder.encode('event: changed\ndata: 1\n\n'));
  }

  /** Marks an item read, as reading it on another device would. */
  readElsewhere(id: string): void {
    this.items = this.items.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item));
  }

  callsTo(prefix: string): RecordedCall[] {
    return this.calls.filter((call) => `${call.method} ${call.url}`.startsWith(prefix));
  }

  #answer(url: string, init: RequestInit): Response {
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    this.calls.push({ method, url, headers });
    const failure = [...this.failures].find(([prefix]) => `${method} ${url}`.startsWith(prefix));
    if (failure) return Response.json({ statusCode: failure[1] }, { status: failure[1] });
    if (url === '/api/auth/me') {
      return this.signedIn
        ? Response.json({ id: 'p-1', name: 'Ada Lovelace', email: 'ada@example.com' })
        : unauthorized();
    }
    if (!this.signedIn || !url.startsWith(INBOX)) return unauthorized();
    return this.#inbox(method, url.slice(INBOX.length));
  }

  #inbox(method: string, path: string): Response {
    if (path === '/stream') return this.#stream();
    if (path === '/unread-count') return Response.json({ unread: this.items.filter((i) => i.readAt === null).length });
    if (method === 'POST' && path === '/read-all') {
      const readAt = new Date().toISOString();
      const marked = this.items.filter((i) => i.readAt === null).length;
      this.items = this.items.map((item) => (item.readAt === null ? { ...item, readAt } : item));
      return Response.json({ marked });
    }
    const byNotification = /^\/by-notification\/([^/?]+)$/u.exec(path);
    if (method === 'GET' && byNotification) {
      // Missing and someone else's look the same: notification-api only finds the signed-in user's items.
      const item = this.items.find(({ notificationId }) => notificationId === decodeURIComponent(byNotification[1]!));
      return item ? Response.json(item) : Response.json({ statusCode: 404 }, { status: 404 });
    }
    const read = /^\/([^/]+)\/read$/u.exec(path);
    if (method === 'POST' && read) {
      this.readElsewhere(decodeURIComponent(read[1]!));
      const item = this.items.find(({ id }) => id === decodeURIComponent(read[1]!));
      return item ? Response.json(item) : Response.json({ statusCode: 404 }, { status: 404 });
    }
    return this.#list(new URLSearchParams(path.replace(/^\?/u, '')));
  }

  #list(query: URLSearchParams): Response {
    const limit = Number(query.get('limit') ?? '20');
    const offset = Number(query.get('cursor') ?? '0');
    const matching = query.get('unread') === 'true' ? this.items.filter((i) => i.readAt === null) : this.items;
    const items = matching.slice(offset, offset + limit);
    const nextCursor = offset + limit < matching.length ? String(offset + limit) : null;
    return Response.json({ items, nextCursor });
  }

  #stream(): Response {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
        this.#streams.add(c);
        c.enqueue(encoder.encode(': open\n\n'));
      },
      cancel: () => {
        if (controller) this.#streams.delete(controller);
      },
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  }
}
