import { describe, expect, it } from 'vitest';

import {
  HEADER_ATTRIBUTES,
  HEADER_EVENTS,
  HEADER_MAJOR,
  HEADER_TAG,
  HEADER_PATHS,
  RETURN_TO_PARAM,
  withReturnTo,
} from './contract.js';

// These names are the public contract external sites code against: renaming one is a breaking change (a new major).
describe('header contract', () => {
  it('pins the loader, manifest, loader-config and bundle paths to a positive integer major', () => {
    expect(Number.isInteger(HEADER_MAJOR)).toBe(true);
    expect(HEADER_MAJOR).toBeGreaterThan(0);
    expect(HEADER_PATHS).toEqual({
      loader: 'header/v1/loader.js',
      manifest: 'header/v1/manifest.json',
      loaderConfig: 'header/v1/loader.json',
      bundles: 'header/v1/bundles/',
    });
  });

  it('keeps the documented tag, attribute and event names', () => {
    expect(HEADER_TAG).toBe('sdg-header');
    expect(HEADER_ATTRIBUTES).toEqual({
      siteTitle: 'site-title',
      userName: 'user-name',
      loginHref: 'login-href',
      fluid: 'fluid',
    });
    expect(HEADER_EVENTS).toEqual({
      login: 'sdg-login',
      logout: 'sdg-logout',
      settings: 'sdg-settings',
      home: 'sdg-home',
    });
    expect(RETURN_TO_PARAM).toBe('return-to');
  });

  it('adds the SDG page to a link to another site, keeping its own query and hash', () => {
    expect(withReturnTo('https://partner.gov.bc.ca/apply?step=1#form', '/services?q=licence')).toBe(
      'https://partner.gov.bc.ca/apply?step=1&return-to=%2Fservices%3Fq%3Dlicence#form',
    );
  });
});
