import { describe, expect, it } from 'vitest';

import { normalizeAddress, normalizeEmail } from './normalize.js';

describe('normalizeEmail (KTD17)', () => {
  it('normalizes ` Jane@Example.COM` and `jane@example.com` to the same address', () => {
    expect(normalizeEmail(' Jane@Example.COM')).toBe('jane@example.com');
    expect(normalizeEmail('jane@example.com')).toBe('jane@example.com');
  });

  it('keeps plus-addresses and dots', () => {
    expect(normalizeEmail(' Jane.Doe+Permits@Example.com\t')).toBe('jane.doe+permits@example.com');
  });
});

describe('normalizeAddress', () => {
  it('throws for in-app, which has no addresses', () => {
    expect(() => normalizeAddress('in-app', 'anything')).toThrow('The in-app channel has no addresses');
  });
});
