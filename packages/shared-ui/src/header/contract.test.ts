import { describe, expect, it } from 'vitest';

import { HEADER_ATTRIBUTES, HEADER_EVENTS, HEADER_MAJOR, HEADER_TAG, headerCdnPath } from './contract.js';

// These names are the public contract external sites code against: renaming one is a breaking change (a new major).
describe('header contract', () => {
  it('builds the CDN path from a positive integer major', () => {
    expect(Number.isInteger(HEADER_MAJOR)).toBe(true);
    expect(HEADER_MAJOR).toBeGreaterThan(0);
    expect(headerCdnPath()).toBe('header/v1/sdg-header.js');
  });

  it('keeps the documented tag, attribute and event names', () => {
    expect(HEADER_TAG).toBe('sdg-header');
    expect(HEADER_ATTRIBUTES).toEqual({
      siteTitle: 'site-title',
      userName: 'user-name',
      loginHref: 'login-href',
      fluid: 'fluid',
    });
    expect(HEADER_EVENTS).toEqual({ login: 'sdg-login', logout: 'sdg-logout', settings: 'sdg-settings' });
  });
});
