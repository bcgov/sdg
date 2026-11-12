import { describe, expect, it } from 'vitest';

import { parseDatabaseUrl, redactDatabaseError } from './database-url.js';

class TestError extends Error {}
const makeError = (message: string) => new TestError(message);

describe('parseDatabaseUrl', () => {
  it('accepts postgres:// and postgresql:// URLs', () => {
    expect(parseDatabaseUrl('postgres://u:p@db:5432/core', makeError).host).toBe('db:5432');
    expect(parseDatabaseUrl('postgresql://db/core', makeError).pathname).toBe('/core');
  });

  it.each([
    [undefined, 'DATABASE_URL is not set.'],
    ['', 'DATABASE_URL is not set.'],
    ['not a url', 'DATABASE_URL is not a valid URL.'],
    ['mysql://u:s3cret@db/core', 'DATABASE_URL must use postgres:// or postgresql://.'],
  ])("throws the caller's error for %s", (raw, message) => {
    expect(() => parseDatabaseUrl(raw, makeError)).toThrow(new TestError(message));
  });
});

describe('redactDatabaseError', () => {
  it('joins the cause chain and masks the URL and the password, raw and decoded', () => {
    const url = new URL('postgres://core:s3cret%2Fpw@db:5432/core');
    const error = new Error(`connect to ${url.href} failed`, { cause: new Error('password s3cret/pw rejected') });
    expect(redactDatabaseError(error, url)).toBe('connect to *** failed: password *** rejected');
  });

  it('describes a thrown non-error as unknown', () => {
    expect(redactDatabaseError('boom', new URL('postgres://db/core'))).toBe('unknown error');
  });
});
