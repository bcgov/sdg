import { describe, expect, it } from 'vitest';

import { formatBirthdate, formatGender, NOT_PROVIDED, orNotProvided } from './format';

describe('profile formatting (R13, KTD4)', () => {
  it('formats a full birthdate as a long date, never shifted by the time zone', () => {
    expect(formatBirthdate('1980-01-05')).toBe('January 5, 1980');
    expect(formatBirthdate('1815-12-10')).toBe('December 10, 1815');
    expect(formatBirthdate('2000-02-29')).toBe('February 29, 2000');
  });

  it('shows a birthdate that is not a full, real date as sent', () => {
    expect(formatBirthdate('1980')).toBe('1980');
    expect(formatBirthdate('1980-13-01')).toBe('1980-13-01');
    expect(formatBirthdate('1981-02-29')).toBe('1981-02-29');
  });

  it('reads Not provided for a missing birthdate', () => {
    expect(formatBirthdate(null)).toBe(NOT_PROVIDED);
  });

  it('maps the known gender values, case-insensitively', () => {
    expect(formatGender('female')).toBe('Female');
    expect(formatGender('MALE')).toBe('Male');
    expect(formatGender('diverse')).toBe('Diverse');
  });

  it('reads Not provided for unknown or missing gender, and shows any other value as sent', () => {
    expect(formatGender('unknown')).toBe(NOT_PROVIDED);
    expect(formatGender(null)).toBe(NOT_PROVIDED);
    expect(formatGender('Two-Spirit')).toBe('Two-Spirit');
  });

  it('reads Not provided for any other missing value', () => {
    expect(NOT_PROVIDED).toBe('Not provided');
    expect(orNotProvided(null)).toBe(NOT_PROVIDED);
    expect(orNotProvided('ada@example.com')).toBe('ada@example.com');
  });
});
