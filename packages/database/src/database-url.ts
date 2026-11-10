/**
 * DATABASE_URL as a postgres:// or postgresql:// URL. Otherwise throws the error `makeError` builds from a message
 * that never echoes the URL (it may carry the password).
 */
export function parseDatabaseUrl(raw: string | undefined, makeError: (message: string) => Error): URL {
  if (!raw) throw makeError('DATABASE_URL is not set.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw makeError('DATABASE_URL is not a valid URL.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw makeError('DATABASE_URL must use postgres:// or postgresql://.');
  }
  return url;
}

/** The messages along the `cause` chain (drizzle wraps the pg error), with `url` and its password masked. */
export function redactDatabaseError(error: unknown, url: URL): string {
  const messages: string[] = [];
  for (let current: unknown = error; current instanceof Error; current = current.cause) messages.push(current.message);
  const message = messages.length > 0 ? messages.join(': ') : 'unknown error';
  const secrets = [url.href, url.password, decodeURIComponent(url.password)].filter(Boolean);
  return secrets.reduce((text, secret) => text.replaceAll(secret, '***'), message);
}
