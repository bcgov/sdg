import { describe, expect, it } from 'vitest';

import { audiences, clientRoles, isServiceAccount } from './tokens.js';

describe('audiences', () => {
  it('reads a single aud string as a one-element list', () => {
    expect(audiences({ aud: 'portal' })).toEqual(['portal']);
  });
  it('keeps the string values of an aud array', () => {
    expect(audiences({ aud: ['portal', 42, 'account'] })).toEqual(['portal', 'account']);
  });
  it('is empty without an aud claim or with one of another type', () => {
    expect(audiences({})).toEqual([]);
    expect(audiences({ aud: { portal: true } })).toEqual([]);
  });
});

describe('isServiceAccount', () => {
  it('recognizes a token carrying a client_id claim', () => {
    expect(isServiceAccount({ azp: 'gateway-caller', client_id: 'gateway-caller' })).toBe(true);
  });
  it('recognizes a service-account- username', () => {
    expect(isServiceAccount({ azp: 'gateway-caller', preferred_username: 'service-account-gateway-caller' })).toBe(
      true,
    );
  });
  it('does not treat a portal-client user token as a service account', () => {
    expect(isServiceAccount({ azp: 'portal', preferred_username: 'jdoe@bcsc', sub: 'user-1' })).toBe(false);
  });
  it('ignores an empty or non-string client_id', () => {
    expect(isServiceAccount({ azp: 'portal', client_id: '' })).toBe(false);
    expect(isServiceAccount({ azp: 'portal', client_id: 7 })).toBe(false);
  });
});

describe('clientRoles', () => {
  it('reads the top-level client_roles claim for the token’s own azp', () => {
    expect(clientRoles({ azp: 'admin', client_roles: ['admin', 'viewer'] }, 'admin')).toEqual(['admin', 'viewer']);
  });
  it('merges resource_access.<azp>.roles with client_roles', () => {
    const claims = {
      azp: 'admin',
      client_roles: ['viewer'],
      resource_access: { admin: { roles: ['admin'] }, account: { roles: ['manage-account'] } },
    };
    expect(clientRoles(claims, 'admin')).toEqual(['admin', 'viewer']);
  });
  it('reads resource_access for another client but never client_roles, which belong to the token’s azp', () => {
    const claims = {
      azp: 'portal',
      client_roles: ['admin'],
      resource_access: { admin: { roles: ['auditor'] } },
    };
    expect(clientRoles(claims, 'admin')).toEqual(['auditor']);
  });
  it('keeps only string roles and tolerates malformed claims', () => {
    expect(clientRoles({ azp: 'admin', client_roles: ['admin', 1, null] }, 'admin')).toEqual(['admin']);
    expect(clientRoles({ azp: 'admin', client_roles: 'admin', resource_access: { admin: 'x' } }, 'admin')).toEqual([]);
    expect(clientRoles({ azp: 'admin', resource_access: { admin: { roles: 'admin' } } }, 'admin')).toEqual([]);
    expect(clientRoles({ azp: 'admin', resource_access: null }, 'admin')).toEqual([]);
  });
  it('does not read inherited properties of resource_access', () => {
    expect(clientRoles({ azp: 'x', resource_access: {} }, 'constructor')).toEqual([]);
  });
});
