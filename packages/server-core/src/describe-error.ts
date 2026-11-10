/** The fields of an error that a service logs (bug 06/09-B1). Everything else on an error object is left out. */
export interface ErrorSummary {
  readonly type: string;
  readonly message: string;
  /** AuthError code, or a Node / openid-client error code. */
  readonly code?: string;
  /** AuthError detail, e.g. the IdP `error` code. */
  readonly detail?: string;
  /** OAuth error code and description (openid-client ResponseBodyError / AuthorizationResponseError). */
  readonly error?: string;
  readonly error_description?: string;
  /** HTTP status of the IdP response. */
  readonly status?: number;
  readonly stack?: string;
  readonly cause?: ErrorSummary;
}

const MAX_DEPTH = 5;
const STRING_FIELDS = ['code', 'detail', 'error', 'error_description'] as const;

function stringFields(error: Error): Partial<Record<(typeof STRING_FIELDS)[number], string>> {
  const fields: Partial<Record<(typeof STRING_FIELDS)[number], string>> = {};
  for (const key of STRING_FIELDS) {
    const value: unknown = Reflect.get(error, key);
    if (typeof value === 'string') fields[key] = value;
  }
  return fields;
}

function summarize(value: unknown, seen: Set<unknown>): ErrorSummary {
  if (!(value instanceof Error)) return { type: typeof value, message: String(value) };
  seen.add(value);
  const status: unknown = Reflect.get(value, 'status');
  const cause = value.cause;
  const followCause = cause !== undefined && !seen.has(cause) && seen.size < MAX_DEPTH;
  return {
    type: value.name,
    message: value.message,
    ...stringFields(value),
    ...(typeof status === 'number' ? { status } : {}),
    ...(value.stack === undefined ? {} : { stack: value.stack }),
    ...(followCause ? { cause: summarize(cause, seen) } : {}),
  };
}

/**
 * A log-safe summary of a thrown value: name, message, stack, AuthError code/detail, OAuth error fields and the cause
 * chain (at most five levels, cycles cut). Log it as `logger.warn({ msg, error: describeError(error) })`: nestjs-pino
 * drops a stack passed as `warn(msg, stack)`, `error(msg, stack)` never shows `cause`, and under the `err` key pino's
 * error serializer would rebuild the summary and drop its cause.
 */
export function describeError(error: unknown): ErrorSummary {
  return summarize(error, new Set());
}
