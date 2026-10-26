import { describe, expect, it } from 'vitest';

import { claimsToAuthUser } from './claims.js';
import { AuthError } from './errors.js';

const base = { iss: 'https://kc.example/realms/sdg', sub: 'user-1' };

describe('claimsToAuthUser', () => {
  describe('display name', () => {
    it('uses name when present', () => {
      const user = claimsToAuthUser({ ...base, name: 'Ada Lovelace', given_name: 'A', preferred_username: 'ada' });
      expect(user.name).toBe('Ada Lovelace');
    });
    it('falls back to given_name + family_name', () => {
      expect(claimsToAuthUser({ ...base, given_name: 'Ada', family_name: 'Lovelace' }).name).toBe('Ada Lovelace');
      expect(claimsToAuthUser({ ...base, name: '  ', given_name: 'Ada' }).name).toBe('Ada');
      expect(claimsToAuthUser({ ...base, family_name: 'Lovelace' }).name).toBe('Lovelace');
    });
    it('falls back to preferred_username, then email, then sub', () => {
      expect(claimsToAuthUser({ ...base, preferred_username: 'ada', email: 'ada@example.com' }).name).toBe('ada');
      expect(claimsToAuthUser({ ...base, email: 'ada@example.com' }).name).toBe('ada@example.com');
      expect(claimsToAuthUser(base).name).toBe('user-1');
    });
  });
  describe('fields', () => {
    it('maps iss, sub, email, email_verified and preferred_username', () => {
      const claims = { ...base, email: 'ada@example.com', email_verified: true, preferred_username: 'ada', extra: 1 };
      const user = claimsToAuthUser(claims);
      expect(user).toEqual({
        issuer: base.iss,
        subject: base.sub,
        name: 'ada',
        email: 'ada@example.com',
        emailVerified: true,
        username: 'ada',
        claims,
      });
      expect(Object.isFrozen(user.claims)).toBe(true);
    });
    it('defaults emailVerified to false and email/username to null', () => {
      const user = claimsToAuthUser({ ...base, email_verified: 'true' });
      expect(user.emailVerified).toBe(false);
      expect(user.email).toBeNull();
      expect(user.username).toBeNull();
    });
    it('throws AuthError(callback_failed) when iss or sub is missing', () => {
      for (const claims of [{ sub: 'user-1' }, { iss: base.iss }, { iss: base.iss, sub: '' }, { iss: 1, sub: 'x' }]) {
        expect(() => claimsToAuthUser(claims)).toThrow(AuthError);
        expect(() => claimsToAuthUser(claims)).toThrow(expect.objectContaining({ code: 'callback_failed' }));
      }
    });
  });
});
