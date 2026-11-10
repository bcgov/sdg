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

  it('accepts a single trailing slash', () => {
    expect(normalizeRequestTarget('/api/v1/portal/x/')?.path).toBe('/api/v1/portal/x/');
  });

  it.each([
    ['an encoded slash', '/api/v1/portal%2fadmin/x'],
    ['an upper-case encoded slash', '/api/v1/portal%2Fadmin/x'],
    ['encoded dots', '/api/v1/portal/%2e%2e/admin/x'],
    ['an upper-case encoded dot', '/api/v1/portal/%2E/x'],
    ['a dot segment', '/api/v1/portal/./x'],
    ['a dot-dot segment', '/api/v1/portal/../admin/x'],
    ['a trailing dot-dot segment', '/api/v1/portal/x/..'],
    ['an empty segment', '/api/v1//portal/x'],
    ['an empty leading segment', '//api/v1/portal/x'],
    ['two trailing slashes', '/api/v1/portal/x//'],
    ['a malformed escape', '/api/v1/portal/%zz'],
    ['a truncated UTF-8 escape', '/api/v1/portal/%E0%A4%A'],
    ['an absolute-form target', 'http://core-api/api/v1/portal/x'],
    ['a relative target', 'api/v1/portal/x'],
    ['an empty target', ''],
  ])('rejects %s', (_case, url) => {
    expect(normalizeRequestTarget(url)).toBeUndefined();
  });
});
