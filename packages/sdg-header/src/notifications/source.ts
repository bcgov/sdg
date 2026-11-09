import type { AccessTokenFn, InboxItem } from '../types.js';

/** The fetch the source calls; `window.fetch` by default. */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** How many of the newest items the header loads. */
export const latestLimit = 20;

/** The source answered with a status outside 2xx. */
export class SourceError extends Error {
  readonly status: number;

  constructor(path: string, status: number) {
    super(`Notifications request ${path} answered ${status}`);
    this.name = 'SourceError';
    this.status = status;
  }
}

/** Direct mode had no token: `accessTokenFn` returned null, so nothing was sent. */
export class TokenUnavailableError extends Error {
  constructor() {
    super('accessTokenFn returned no token');
    this.name = 'TokenUnavailableError';
  }
}

export interface SourceOptions {
  /** The base URL every path is relative to: a relay on the host's origin, or notification-api's `/api/v1/me`. */
  url: string;
  /** Direct mode when set: each request carries its token. Relay mode, with the host's cookies, when not. */
  accessTokenFn?: AccessTokenFn | undefined;
  fetch?: FetchFn | undefined;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  /** Not a user action: sends `sdg-background: 1` and asks for the token with `background: true` (KTD8). */
  background: boolean;
  accept?: string;
  signal?: AbortSignal;
}

/** The notifications endpoints at one configured source (KTD2, KTD7). */
export class NotificationsSource {
  readonly url: string;
  readonly #accessTokenFn: AccessTokenFn | undefined;
  readonly #fetch: FetchFn;

  constructor({ url, accessTokenFn, fetch }: SourceOptions) {
    this.url = url.replace(/\/+$/u, '');
    this.#accessTokenFn = accessTokenFn;
    this.#fetch = fetch ?? ((input, init) => window.fetch(input, init));
  }

  async unreadCount(background = true): Promise<number> {
    const body = await this.#json('inbox/unread-count', { background });
    if (isRecord(body) && typeof body.unread === 'number') return body.unread;
    throw unexpected('inbox/unread-count');
  }

  /** The newest items, read and unread. */
  async latest(background = true): Promise<InboxItem[]> {
    const path = `inbox?limit=${latestLimit}`;
    const body = await this.#json(path, { background });
    if (isRecord(body) && Array.isArray(body.items) && body.items.every(isInboxItem)) return body.items;
    throw unexpected(path);
  }

  async markRead(itemId: string): Promise<InboxItem> {
    const path = `inbox/${encodeURIComponent(itemId)}/read`;
    const body = await this.#json(path, { method: 'POST', background: false });
    if (isInboxItem(body)) return body;
    throw unexpected(path);
  }

  /** Marks read every item unread when the server runs it (KTD9); no body. */
  async markAllRead(): Promise<void> {
    const response = await this.#request('inbox/read-all', { method: 'POST', background: false });
    await response.body?.cancel();
  }

  /** Opens the live stream; resolves once its headers arrive with a 2xx. */
  async stream(signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const response = await this.#request('inbox/stream', { background: true, accept: 'text/event-stream', signal });
    if (!response.body) throw new SourceError('inbox/stream', response.status);
    return response.body;
  }

  async #json(path: string, options: RequestOptions): Promise<unknown> {
    const response = await this.#request(path, options);
    const body: unknown = await response.json();
    return body;
  }

  async #request(path: string, { method = 'GET', background, accept, signal }: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { accept: accept ?? 'application/json' };
    if (background) headers['sdg-background'] = '1';
    if (this.#accessTokenFn) {
      const token = await this.#accessTokenFn({ background });
      if (token === null) throw new TokenUnavailableError();
      headers.authorization = `Bearer ${token}`;
    }
    const credentials = this.#accessTokenFn ? 'omit' : 'same-origin';
    const response = await this.#fetch(`${this.url}/${path}`, { method, headers, credentials, signal });
    if (!response.ok) {
      // Read the unused body anyway: Chromium never finishes a request whose body is left unread.
      await response.body?.cancel();
      throw new SourceError(path, response.status);
    }
    return response;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';

function isInboxItem(value: unknown): value is InboxItem {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.notificationId === 'string' &&
    isNullableString(value.title) &&
    isNullableString(value.excerpt) &&
    isNullableString(value.readAt) &&
    typeof value.createdAt === 'string'
  );
}

const unexpected = (path: string): Error => new Error(`Notifications request ${path} returned an unexpected body`);
