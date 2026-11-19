import { describe, expect, it } from 'vitest';

import { profileView } from './profile-view.js';

describe('profileView (KTD4)', () => {
  it('Should normalize every field from full userinfo claims', () => {
    expect(
      profileView({
        sub: 'resident-1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        phone_number: '+1 250 555 0100',
        birthdate: '1815-12-10',
        gender: 'female',
        address: { formatted: '12 St James Sq\nLondon SW1Y 4JH' },
      }),
    ).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phoneNumber: '+1 250 555 0100',
      birthdate: '1815-12-10',
      gender: 'female',
      address: ['12 St James Sq', 'London SW1Y 4JH'],
    });
  });

  it('Should answer null for every claim userinfo leaves out', () => {
    expect(profileView({ sub: 'resident-1' })).toEqual({
      name: null,
      email: null,
      phoneNumber: null,
      birthdate: null,
      gender: null,
      address: null,
    });
  });

  it('Should join given and family names when there is no name claim, and never fall back to other claims', () => {
    expect(profileView({ given_name: 'Ada', family_name: 'Lovelace' }).name).toBe('Ada Lovelace');
    expect(profileView({ family_name: 'Lovelace' }).name).toBe('Lovelace');
    expect(profileView({ preferred_username: 'ada@bcsc', email: 'ada@example.com' }).name).toBeNull();
  });

  it('Should treat blank strings and non-strings as missing', () => {
    const view = profileView({ name: '  ', email: '', phone_number: 5550100, birthdate: null, gender: '' });
    expect(view).toMatchObject({ name: null, email: null, phoneNumber: null, birthdate: null, gender: null });
  });

  it('Should build address lines from the parts when there is no formatted value', () => {
    expect(
      profileView({
        address: {
          street_address: '1 Main St\nUnit 4',
          locality: 'Victoria',
          region: 'BC',
          postal_code: 'V8W 1A1',
          country: 'CA',
        },
      }).address,
    ).toEqual(['1 Main St', 'Unit 4', 'Victoria BC', 'V8W 1A1', 'CA']);
    expect(profileView({ address: { locality: 'Victoria', postal_code: 'V8W 1A1' } }).address).toEqual([
      'Victoria',
      'V8W 1A1',
    ]);
  });

  it('Should answer null for an address with nothing usable in it', () => {
    expect(profileView({ address: { formatted: ' \n ', locality: '' } }).address).toBeNull();
    expect(profileView({ address: '12 St James Sq' }).address).toBeNull();
  });
});
