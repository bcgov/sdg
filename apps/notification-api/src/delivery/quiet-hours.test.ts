import { describe, expect, it } from 'vitest';

import { nextAllowedInstant } from './quiet-hours.js';

// Los Angeles, not Vancouver: recent tz data puts British Columbia on permanent UTC−7, so it has no DST changes.
const PACIFIC = 'America/Los_Angeles';
const NIGHT = { start: '22:00', end: '07:00' };

const next = (at: string, window = NIGHT, zone = PACIFIC) =>
  nextAllowedInstant(new Date(at), window, zone).toISOString();

describe('nextAllowedInstant (R40)', () => {
  it('covers AE2: an email due at 23:30 inside 22:00–07:00 waits until 07:00 local the next morning', () => {
    // 23:30 PST on Tuesday 5 January 2027 → 07:00 PST on Wednesday.
    expect(next('2027-01-06T07:30:00Z')).toBe('2027-01-06T15:00:00.000Z');
  });

  it('leaves an instant outside quiet hours as it is', () => {
    expect(next('2027-01-05T18:00:00Z')).toBe('2027-01-05T18:00:00.000Z');
    // 07:00 itself is the first allowed minute; 21:59 the last.
    expect(next('2027-01-05T15:00:00Z')).toBe('2027-01-05T15:00:00.000Z');
    expect(next('2027-01-06T05:59:00Z')).toBe('2027-01-06T05:59:00.000Z');
  });

  it('ends an after-midnight hold at 07:00 the same local day', () => {
    // 03:00 PST → 07:00 PST.
    expect(next('2027-01-06T11:00:00Z')).toBe('2027-01-06T15:00:00.000Z');
  });

  it('ends at local 07:00 across the spring-forward change, 6.5 hours after 23:30', () => {
    // 23:30 PST on 13 March 2027; clocks jump to PDT at 02:00 on the 14th; 07:00 PDT is 14:00 UTC.
    expect(next('2027-03-14T07:30:00Z')).toBe('2027-03-14T14:00:00.000Z');
  });

  it('ends at local 07:00 across the fall-back change, 8.5 hours after 23:30', () => {
    // 23:30 PDT on 6 November 2027; clocks fall back to PST at 02:00 on the 7th; 07:00 PST is 15:00 UTC.
    expect(next('2027-11-07T06:30:00Z')).toBe('2027-11-07T15:00:00.000Z');
  });

  it('handles a daytime window and other zones', () => {
    const office = { start: '09:00', end: '17:00' };
    // 10:00 in Toronto (EST, UTC−5) → 17:00 EST.
    expect(next('2027-01-05T15:00:00Z', office, 'America/Toronto')).toBe('2027-01-05T22:00:00.000Z');
    // 08:00 in Kathmandu (UTC+5:45) is outside it.
    expect(next('2027-01-05T02:15:00Z', office, 'Asia/Kathmandu')).toBe('2027-01-05T02:15:00.000Z');
  });

  it('moves an end time the spring-forward change skips to just past the jump', () => {
    // 01:30 PST on 14 March 2027 inside 01:00–02:30; 02:30 does not exist that night, so the hold ends at 03:30 PDT.
    expect(next('2027-03-14T09:30:00Z', { start: '01:00', end: '02:30' })).toBe('2027-03-14T10:30:00.000Z');
  });

  it('treats a window from a time to itself as no quiet hours', () => {
    expect(next('2027-01-06T07:30:00Z', { start: '07:00', end: '07:00' })).toBe('2027-01-06T07:30:00.000Z');
  });
});
