import { describe, expect, it } from 'vitest';

import { parseSearch, stringifySearch } from '.';

describe('parseSearch', () => {
  it('keeps every value a plain string, including ones JSON would parse', () => {
    expect(parseSearch('?q=1e3&page=3&on=true&none=null&id=007&quoted=%22x%22')).toEqual({
      q: '1e3',
      page: '3',
      on: 'true',
      none: 'null',
      id: '007',
      quoted: '"x"',
    });
  });

  it('decodes encoded values and reads an empty search as no params', () => {
    expect(parseSearch('?q=dog+licence&tag=a%26b')).toEqual({ q: 'dog licence', tag: 'a&b' });
    expect(parseSearch('')).toEqual({});
  });
});

describe('stringifySearch', () => {
  it('writes strings, numbers and booleans unquoted and drops other values', () => {
    expect(stringifySearch({ q: '007', page: 3, on: true, gone: undefined, nil: null, obj: { a: 1 } })).toBe(
      '?q=007&page=3&on=true',
    );
  });

  it('returns an empty string when nothing is left to write', () => {
    expect(stringifySearch({})).toBe('');
    expect(stringifySearch({ gone: undefined })).toBe('');
  });

  it('round-trips through parseSearch', () => {
    const search = { q: 'dog licence', id: '007', tag: 'a&b' };
    expect(parseSearch(stringifySearch(search))).toEqual(search);
  });
});
