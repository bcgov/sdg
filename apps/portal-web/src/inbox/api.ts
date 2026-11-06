import { BACKGROUND_HEADER } from '../background-fetch';

/** portal-api's relay to notification-api's `me/` endpoints. */
export const NOTIFICATIONS_PATH = '/api/v1/notifications';

const INBOX_PATH = `${NOTIFICATIONS_PATH}/inbox`;

/** How many items each page of the inbox loads (R11). */
export const PAGE_SIZE = 20;

/** One of the signed-in user's inbox items, with the fields the inbox page uses. */
export interface InboxItem {
  id: string;
  notificationId: string;
  title: string | null;
  excerpt: string | null;
  readAt: string | null;
  createdAt: string;
}

/** One item as its notification page shows it: the full sanitized HTML body and the sender's action link. */
export interface InboxItemDetail extends InboxItem {
  /** HTML that notification-api has already sanitized. */
  body: string | null;
  actionUrl: string | null;
}

export interface InboxPage {
  items: InboxItem[];
  nextCursor: string | null;
}

/** An inbox request answered outside 2xx; a 401 means the session ended. */
export class InboxRequestError extends Error {
  readonly status: number;

  constructor(path: string, status: number) {
    super(`${path} failed with ${status}`);
    this.name = 'InboxRequestError';
    this.status = status;
  }
}

export const isSessionEnded = (error: unknown): boolean => error instanceof InboxRequestError && error.status === 401;

export const isNotFound = (error: unknown): boolean => error instanceof InboxRequestError && error.status === 404;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';

function isInboxItem(value: unknown): value is InboxItem {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['notificationId'] === 'string' &&
    isNullableString(value['title']) &&
    isNullableString(value['excerpt']) &&
    isNullableString(value['readAt']) &&
    typeof value['createdAt'] === 'string'
  );
}

const isInboxItemDetail = (value: unknown): value is InboxItemDetail =>
  isRecord(value) && isInboxItem(value) && isNullableString(value['body']) && isNullableString(value['actionUrl']);

function isInboxPage(value: unknown): value is InboxPage {
  return (
    isRecord(value) &&
    Array.isArray(value['items']) &&
    value['items'].every(isInboxItem) &&
    isNullableString(value['nextCursor'])
  );
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  /** Not a user action (a refetch): sends `sdg-background: 1`, so it does not extend the sign-in (KTD8). */
  background?: boolean;
  signal?: AbortSignal;
}

async function requestJson(path: string, { method = 'GET', background = false, signal }: RequestOptions) {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (background) headers[BACKGROUND_HEADER] = '1';
  const response = await fetch(path, { method, credentials: 'same-origin', headers, signal: signal ?? null });
  if (!response.ok) {
    // Read the unused body anyway: Chromium never finishes a request whose body is left unread.
    await response.text();
    throw new InboxRequestError(`${method} ${path}`, response.status);
  }
  const body: unknown = await response.json();
  return body;
}

const unexpected = (path: string) => new Error(`${path} returned an unexpected body`);

export interface PageRequest {
  unread: boolean;
  cursor: string | undefined;
  background: boolean;
  signal: AbortSignal;
}

/** One page of the inbox, newest first; `nextCursor` is null on the last page. */
export async function fetchInboxPage({ unread, cursor, background, signal }: PageRequest): Promise<InboxPage> {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (unread) query.set('unread', 'true');
  if (cursor !== undefined) query.set('cursor', cursor);
  const path = `${INBOX_PATH}?${query.toString()}`;
  const body = await requestJson(path, { background, signal });
  if (!isInboxPage(body)) throw unexpected(`GET ${path}`);
  return body;
}

export async function fetchUnreadCount(background: boolean, signal: AbortSignal): Promise<number> {
  const path = `${INBOX_PATH}/unread-count`;
  const body = await requestJson(path, { background, signal });
  if (!isRecord(body) || typeof body['unread'] !== 'number') throw unexpected(`GET ${path}`);
  return body['unread'];
}

/**
 * The signed-in user's item for a notification. Missing, malformed and someone else's all answer 404 (R18). Reading it
 * has no side effects, so a preload may fetch it (KTD12).
 */
export async function fetchItemByNotification(
  notificationId: string,
  background: boolean,
  signal: AbortSignal,
): Promise<InboxItemDetail> {
  const path = `${INBOX_PATH}/by-notification/${encodeURIComponent(notificationId)}`;
  const body = await requestJson(path, { background, signal });
  if (!isInboxItemDetail(body)) throw unexpected(`GET ${path}`);
  return body;
}

/** Marks one item read (a user action); returns the item as now stored. No body, so no content type is needed. */
export async function markRead(itemId: string): Promise<InboxItem> {
  const path = `${INBOX_PATH}/${encodeURIComponent(itemId)}/read`;
  const body = await requestJson(path, { method: 'POST' });
  if (!isInboxItem(body)) throw unexpected(`POST ${path}`);
  return body;
}

/** Marks read every item that is unread when the server runs it, loaded here or not (R20). */
export async function markAllRead(): Promise<void> {
  await requestJson(`${INBOX_PATH}/read-all`, { method: 'POST' });
}
