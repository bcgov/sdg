export type AuthErrorCode = 'invalid_state' | 'callback_failed' | 'discovery_failed' | 'invalid_token';

const MESSAGES: Record<AuthErrorCode, string> = {
  invalid_state: 'Authorization state is missing or does not match',
  callback_failed: 'Authorization callback failed',
  discovery_failed: 'OpenID Provider discovery failed',
  invalid_token: 'Token is invalid',
};

export interface AuthErrorOptions {
  /** Server-log detail (e.g. the IdP `error` code). Never send it to clients. */
  detail?: string;
  cause?: unknown;
}

/** Error raised by `@repo/auth`. The message is generic; `detail` and `cause` are for server logs only. */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly detail: string | undefined;

  constructor(code: AuthErrorCode, options: AuthErrorOptions = {}) {
    super(MESSAGES[code], options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AuthError';
    this.code = code;
    this.detail = options.detail;
  }
}

export function isAuthError(value: unknown): value is AuthError {
  return value instanceof AuthError;
}
