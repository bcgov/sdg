import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import {
  clampOffset,
  containsPattern,
  cursorPageSchema,
  cursorQuerySchema,
  numberedPageSchema,
  numberedQuerySchema,
  type CursorQuery,
  type NumberedQuery,
} from './list-query.js';

const numbered = numberedQuerySchema({
  sort: { key: 'asc', overridesOn: 'desc' },
  defaultSort: 'key',
  filters: { enabled: z.enum(['true', 'false']).optional() },
});
const cursor = cursorQuerySchema({ key: z.string().optional() });

describe('numberedQuerySchema (R12, KTD2)', () => {
  it('Should default to the first 20 rows by the default sort in its first direction', () => {
    expect(numbered.parse({})).toEqual({ limit: 20, offset: 0, q: undefined, sort: 'key', order: 'asc' });
  });

  it('Should read query strings as numbers and keep per-endpoint filters', () => {
    expect(numbered.parse({ limit: '50', offset: '40', q: ' check ', enabled: 'false' })).toEqual({
      limit: 50,
      offset: 40,
      q: 'check',
      sort: 'key',
      order: 'asc',
      enabled: 'false',
    });
  });

  it.each([
    ['limit 0', { limit: '0' }],
    ['limit 101', { limit: '101' }],
    ['offset -1', { offset: '-1' }],
    ['an unknown sort column', { sort: 'description' }],
    ['an unknown order', { order: 'up' }],
    ['an unknown filter value', { enabled: 'maybe' }],
  ])('Should refuse %s', (_case, query) => {
    expect(numbered.safeParse(query).success).toBe(false);
  });

  it('Should default the order to the sort column’s first direction (R4)', () => {
    expect(numbered.parse({ sort: 'overridesOn' })).toMatchObject({ sort: 'overridesOn', order: 'desc' });
    expect(numbered.parse({ sort: 'key' })).toMatchObject({ sort: 'key', order: 'asc' });
  });

  it('Should type the parsed query with the declared columns and filters', () => {
    const query = numbered.parse({});
    expectTypeOf(query.sort).toEqualTypeOf<'key' | 'overridesOn'>();
    expectTypeOf(query.order).toEqualTypeOf<'asc' | 'desc'>();
    expectTypeOf(query.q).toEqualTypeOf<string | undefined>();
    expectTypeOf(query.limit).toEqualTypeOf<number>();
    expectTypeOf(query.enabled).toEqualTypeOf<'true' | 'false' | undefined>();
    expectTypeOf<NumberedQuery<'key' | 'overridesOn', { enabled: z.ZodOptional<z.ZodString> }>>().toHaveProperty(
      'order',
    );
  });

  it('Should keep an explicit order', () => {
    expect(numbered.parse({ sort: 'overridesOn', order: 'asc' })).toMatchObject({ order: 'asc' });
    expect(numbered.parse({ sort: 'key', order: 'desc' })).toMatchObject({ order: 'desc' });
  });

  it('Should treat a blank search as no search', () => {
    expect(numbered.parse({ q: '   ' }).q).toBeUndefined();
  });

  it('Should fall back to ascending order when sort is missing, non-string, or unknown', () => {
    const withOptionalSort = numberedQuerySchema({
      sort: { key: 'desc' },
      defaultSort: 'key',
      filters: { sort: z.union([z.string(), z.number()]).optional() },
    });
    expect(withOptionalSort.parse({}).order).toBe('asc');
    expect(withOptionalSort.parse({ sort: 123 }).order).toBe('asc');
    expect(withOptionalSort.parse({ sort: 'unknown' }).order).toBe('asc');
  });
});

describe('cursorQuerySchema (R13, KTD3)', () => {
  it('Should default to the newest 20 rows', () => {
    expect(cursor.parse({})).toEqual({ limit: 20 });
  });

  it('Should read either cursor as an id and keep extra fields', () => {
    expect(cursor.parse({ key: 'hello_world', before: '42', limit: '10' })).toEqual({
      key: 'hello_world',
      before: 42,
      limit: 10,
    });
    expect(cursor.parse({ after: '7' })).toEqual({ limit: 20, after: 7 });
  });

  it('Should type the parsed query with the extra fields', () => {
    const query: CursorQuery<{ key: z.ZodOptional<z.ZodString> }> = cursor.parse({});
    expectTypeOf(query.key).toEqualTypeOf<string | undefined>();
    expectTypeOf(query.before).toEqualTypeOf<number | undefined>();
    expectTypeOf(query.after).toEqualTypeOf<number | undefined>();
  });

  it.each([
    ['before and after together', { before: '42', after: '7' }],
    ['limit 0', { limit: '0' }],
    ['limit 101', { limit: '101' }],
    ['a cursor that is not a positive id', { before: '0' }],
  ])('Should refuse %s', (_case, query) => {
    expect(cursor.safeParse(query).success).toBe(false);
  });
});

describe('page response schemas (R12, R13)', () => {
  const item = z.object({ key: z.string() });

  it('Should describe a numbered page', () => {
    const page = { items: [{ key: 'a' }], total: 1, limit: 20, offset: 0 };
    expect(numberedPageSchema(item).parse(page)).toEqual(page);
    expect(numberedPageSchema(item).safeParse({ items: [], limit: 20, offset: 0 }).success).toBe(false);
  });

  it('Should describe a cursor page with null at either end', () => {
    const page = { items: [{ key: 'a' }], older: 3, newer: null };
    expect(cursorPageSchema(item).parse(page)).toEqual(page);
    expect(cursorPageSchema(item).safeParse({ items: [], older: 3 }).success).toBe(false);
  });
});

describe('clampOffset (R14)', () => {
  it.each([
    [120, 20, 100, 80],
    [120, 20, 134, 120],
    [140, 20, 134, 120],
    [134, 20, 134, 120],
    [40, 20, 0, 0],
    [0, 20, 0, 0],
    [40, 20, 100, 40],
  ])('Should clamp offset %i at limit %i with %i rows to %i', (offset, limit, total, expected) => {
    expect(clampOffset(offset, limit, total)).toBe(expected);
  });
});

describe('containsPattern (KTD4)', () => {
  it.each([
    ['j_smith', '%j\\_smith%'],
    ['50%', '%50\\%%'],
    ['a\\b', '%a\\\\b%'],
    ['check', '%check%'],
  ])('Should match %s literally anywhere', (query, expected) => {
    expect(containsPattern(query)).toBe(expected);
  });
});
