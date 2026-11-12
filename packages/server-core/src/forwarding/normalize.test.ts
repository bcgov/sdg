import { describe, expect, it } from 'vitest';

import { normalizeRequestTarget } from './normalize.js';

describe('normalizeRequestTarget', () => {
  it('returns the path for classification and the target, query included, unchanged for forwarding', () => {
    expect(normalizeRequestTarget('/api/v1/portal/x?page=2&next=%2Fa')).toEqual({
      path: '/api/v1/portal/x',
      target: '/api/v1/portal/x?page=2&next=%2Fa',
    });
  });

  it('accepts a percent-encoded space in the last segment, decoding it only for classification', () => {
    expect(normalizeRequestTarget('/api/v1/portal/files/a%20b')).toEqual({
      path: '/api/v1/portal/files/a b',
      target: '/api/v1/portal/files/a%20b',
    });
  });

  it('accepts a backslash in the query, which the URL parser never reads as path', () => {
    expect(normalizeRequestTarget('/api/v1/portal/search?q=C:\\temp%5cx')).toEqual({
      path: '/api/v1/portal/search',
      target: '/api/v1/portal/search?q=C:\\temp%5cx',
    });
  });

  it('accepts a single trailing slash', () => {
    expect(normalizeRequestTarget('/api/v1/portal/x/')?.path).toBe('/api/v1/portal/x/');
  });

  it.each([
    ['an encoded slash', '/api/v1/portal%2fconsole/x'],
    ['an upper-case encoded slash', '/api/v1/portal%2Fconsole/x'],
    ['encoded dots', '/api/v1/portal/%2e%2e/console/x'],
    ['an upper-case encoded dot', '/api/v1/portal/%2E/x'],
    ['a dot segment', '/api/v1/portal/./x'],
    ['a dot-dot segment', '/api/v1/portal/../console/x'],
    ['a trailing dot-dot segment', '/api/v1/portal/x/..'],
    ['an empty segment', '/api/v1//portal/x'],
    ['an empty leading segment', '//api/v1/portal/x'],
    ['two trailing slashes', '/api/v1/portal/x//'],
    ['a malformed escape', '/api/v1/portal/%zz'],
    ['a truncated UTF-8 escape', '/api/v1/portal/%E0%A4%A'],
    ['an absolute-form target', 'http://core-api/api/v1/portal/x'],
    ['a relative target', 'api/v1/portal/x'],
    ['an empty target', ''],
    ['backslash dot-dot segments', '/api/v1/portal/..\\..\\..\\internal/x'],
    ['a backslash inside a segment', '/api/v1/portal/a\\b'],
    ['an encoded backslash', '/api/v1/portal/..%5c..%5c..%5cinternal/x'],
    ['an upper-case encoded backslash', '/api/v1/portal/a%5Cb'],
  ])('rejects %s', (_case, url) => {
    expect(normalizeRequestTarget(url)).toBeUndefined();
  });
});
