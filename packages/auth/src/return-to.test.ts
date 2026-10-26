import { describe, expect, it } from 'vitest';

import { safeReturnTo } from './return-to.js';

describe('safeReturnTo', () => {
  describe('accepted', () => {
    it('returns same-origin relative paths with query and hash', () => {
      for (const value of ['/', '/dashboard', '/a/b?x=1&y=two#section', '/search?q=http://x', '/files/a:b']) {
        expect(safeReturnTo(value)).toBe(value);
      }
    });
  });
  describe('rejected', () => {
    it('returns the fallback for absolute URLs and schemes', () => {
      for (const value of [
        'https://evil.example',
        'http://evil.example/x',
        'javascript:alert(1)',
        'data:text/html,x',
      ]) {
        expect(safeReturnTo(value, '/home')).toBe('/home');
      }
      expect(safeReturnTo('dashboard')).toBe('/');
    });
    it('returns the fallback for protocol-relative and backslash paths', () => {
      for (const value of ['//evil.example', '///evil.example', '/\\evil.example', '/\\/evil.example']) {
        expect(safeReturnTo(value)).toBe('/');
      }
    });
    it('returns the fallback for control characters, empty and non-string input', () => {
      for (const value of [
        '/\t/evil.example',
        '/a\nb',
        '/a\u0000',
        '/a\u007f',
        '',
        undefined,
        null,
        42,
        ['/a'],
        { a: 1 },
      ]) {
        expect(safeReturnTo(value, '/fallback')).toBe('/fallback');
      }
    });
  });
});
