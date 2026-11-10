/**
 * How admin-web reads an admin-api answer other than success. The app acts on the kind, never on a status:
 * - `session-ended`: 401, the BFF has no session (or core-api refused its token and the BFF ended it): back to sign-in.
 * - `unavailable`: 503 (core-api or Keycloak down), 502/504 from the edge, or no answer at all: retry, stay put.
 * - `not-authorized`: core-api's 403, the caller is not an administrator: the not-authorized page.
 * - `blocked`: any other 403, the BFF's origin guard or the edge's WAF: nothing an administrator can fix but a reload.
 * - `not-found`, `conflict`, `invalid`: 404, 409 and 400, with the server's reason.
 */
export type ApiErrorKind =
  | 'session-ended'
  | 'unavailable'
  | 'not-authorized'
  | 'blocked'
  | 'not-found'
  | 'conflict'
  | 'invalid'
  | 'unexpected';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  /** The server's own message(s), e.g. a 400's validation issues. */
  readonly reasons: readonly string[];

  constructor(kind: ApiErrorKind, status: number | undefined, reasons: readonly string[] = [], cause?: unknown) {
    super(`admin-api request failed (${kind}${status === undefined ? '' : `, ${status}`})`, { cause });
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.reasons = reasons;
  }
}

/** bff-core's origin guard (`OriginGuard`) refuses with this message; core-api's refusals never use it. */
export const ORIGIN_REFUSAL_MESSAGE = 'Cross-origin request refused';

const STATUS_KINDS: Readonly<Record<number, ApiErrorKind>> = {
  400: 'invalid',
  401: 'session-ended',
  404: 'not-found',
  409: 'conflict',
  502: 'unavailable',
  503: 'unavailable',
  504: 'unavailable',
};

/** A Nest error body's `message`, a string or a list of validation issues. */
function messagesOf(body: unknown): string[] {
  if (typeof body !== 'object' || body === null || !('message' in body)) return [];
  const { message } = body;
  if (typeof message === 'string') return [message];
  if (Array.isArray(message)) return message.filter((item): item is string => typeof item === 'string');
  return [];
}

/**
 * Only a Nest JSON 403 from core-api means "not an administrator". The origin guard's 403 names itself, and a 403
 * without a Nest body comes from something in front of admin-api (the edge's WAF).
 */
function forbiddenKind(body: unknown): ApiErrorKind {
  const isNestBody = typeof body === 'object' && body !== null && 'statusCode' in body && body.statusCode === 403;
  if (!isNestBody || messagesOf(body).includes(ORIGIN_REFUSAL_MESSAGE)) return 'blocked';
  return 'not-authorized';
}

async function readBody(response: Response): Promise<unknown> {
  // Always read the body: Chromium never finishes a request whose body is left unread.
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export interface ApiRequest {
  readonly method?: 'GET' | 'POST' | 'DELETE';
  readonly body?: unknown;
}

/**
 * The one way admin-web calls admin-api: same-origin, so the session cookie goes along and the browser's Origin
 * satisfies the BFF's origin guard. Resolves the parsed JSON body (undefined for 204); rejects with an `ApiError`.
 */
export async function apiRequest(path: string, { method = 'GET', body }: ApiRequest = {}): Promise<unknown> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    throw new ApiError('unavailable', undefined, [], error);
  }
  const parsed = await readBody(response);
  if (response.ok) return parsed;
  const kind = response.status === 403 ? forbiddenKind(parsed) : (STATUS_KINDS[response.status] ?? 'unexpected');
  throw new ApiError(kind, response.status, messagesOf(parsed));
}

/** Narrows a caught error to the kinds the app reacts to. */
export function apiErrorKind(error: unknown): ApiErrorKind {
  return error instanceof ApiError ? error.kind : 'unexpected';
}
