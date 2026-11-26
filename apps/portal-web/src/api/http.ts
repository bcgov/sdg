/**
 * How portal-web reads a portal-api answer other than success. The app acts on the kind, never on a status:
 * - `session-ended`: 401, the BFF has no session (it expired, or Keycloak refused its refresh and the BFF ended it):
 *   back to sign-in.
 * - `unavailable`: 503 (core-api or Keycloak down), 502/504 from the edge, or no answer at all: the screen's own
 *   error state, and the session is kept.
 * - `unexpected`: anything else.
 */
export type ApiErrorKind = 'session-ended' | 'unavailable' | 'unexpected';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;

  constructor(kind: ApiErrorKind, status: number | undefined, cause?: unknown) {
    const detail = status === undefined ? kind : `${kind}, ${status}`;
    super(`portal-api request failed (${detail})`, { cause });
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

const STATUS_KINDS: Readonly<Record<number, ApiErrorKind>> = {
  401: 'session-ended',
  502: 'unavailable',
  503: 'unavailable',
  504: 'unavailable',
};

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
  readonly method?: 'GET' | 'POST';
}

/**
 * The one way portal-web calls portal-api for data that needs a session: same-origin, so the session cookie goes along
 * and the browser's Origin satisfies the BFF's origin guard. Resolves the parsed body (undefined when empty; a body
 * that is not JSON comes back as its text); rejects with an `ApiError`.
 */
export async function apiRequest(path: string, { method = 'GET' }: ApiRequest = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { method, credentials: 'same-origin', headers: { accept: 'application/json' } });
  } catch (error) {
    throw new ApiError('unavailable', undefined, error);
  }
  const parsed = await readBody(response);
  if (response.ok) return parsed;
  throw new ApiError(STATUS_KINDS[response.status] ?? 'unexpected', response.status);
}
