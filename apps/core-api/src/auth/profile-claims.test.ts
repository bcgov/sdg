import { describe, expect, it, vi } from 'vitest';

import { PROFILE_CLAIMS, warnOnTokenProfileClaims } from './profile-claims.js';

describe('profile claims (R17, R19, KTD5, KTD8)', () => {
  it('Should name the profile claims that must never be stored', () => {
    expect([...PROFILE_CLAIMS].toSorted()).toEqual([
      'address',
      'birthdate',
      'gender',
      'phone_number',
      'phone_number_verified',
    ]);
  });

  it('Should warn once, naming only the profile claim keys a token carries', () => {
    const logger = { warn: vi.fn<(message: unknown) => void>() };
    warnOnTokenProfileClaims(logger, {
      sub: 'resident-1',
      email: 'ada@example.com',
      birthdate: '1815-12-10',
      address: { formatted: '12 St James Sq' },
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [entry] = logger.warn.mock.calls[0] ?? [];
    expect(entry).toMatchObject({ claims: ['address', 'birthdate'] });
    const logged = JSON.stringify(logger.warn.mock.calls);
    expect(logged).not.toContain('1815-12-10');
    expect(logged).not.toContain('St James');
  });

  it('Should not warn when a token carries no profile claims', () => {
    const logger = { warn: vi.fn<(message: unknown) => void>() };
    warnOnTokenProfileClaims(logger, { sub: 'resident-1', email: 'ada@example.com' });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
