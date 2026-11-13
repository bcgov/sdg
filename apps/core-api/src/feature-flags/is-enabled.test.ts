import { describe, expect, it } from 'vitest';

import { isEnabled, type FeatureFlag } from './is-enabled.js';

const KEY = 'hello_world';
// Buckets computed outside this code: sha1(`hello_world:<id>`), first 4 bytes big-endian, mod 100.
const BUCKET_82 = '00000000-0000-4000-8000-000000000001';
const BUCKET_7 = '00000000-0000-4000-8000-000000000002';

const flags = (flag: Partial<FeatureFlag> = {}) =>
  new Map([[KEY, { key: KEY, enabled: true, rolloutPct: 100, ...flag }]]);
const none = new Map<string, boolean>();

describe('isEnabled (R3)', () => {
  it.each([
    [BUCKET_82, 82, false],
    [BUCKET_82, 83, true],
    [BUCKET_7, 7, false],
    [BUCKET_7, 8, true],
  ])('Should put %s in a fixed bucket, so a %i percent rollout gives %s', (id, rolloutPct, expected) => {
    expect(isEnabled(KEY, id, flags({ rolloutPct }), none)).toBe(expected);
  });

  it('Should return an override’s value even for a disabled or missing flag', () => {
    const on = new Map([[`${KEY}:${BUCKET_7}`, true]]);
    expect(isEnabled(KEY, BUCKET_7, flags({ enabled: false }), on)).toBe(true);
    expect(isEnabled(KEY, BUCKET_7, new Map(), on)).toBe(true);
    const off = new Map([[`${KEY}:${BUCKET_7}`, false]]);
    expect(isEnabled(KEY, BUCKET_7, flags(), off)).toBe(false);
  });

  it('Should return false for a disabled flag with no override', () => {
    expect(isEnabled(KEY, BUCKET_7, flags({ enabled: false }), none)).toBe(false);
    expect(isEnabled(KEY, BUCKET_7, new Map(), none)).toBe(false);
  });

  it('Should be monotonic in the rollout percentage for one key and id (AE4)', () => {
    const ids = Array.from({ length: 50 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    for (const id of ids) {
      const byPct = Array.from({ length: 101 }, (_, rolloutPct) => isEnabled(KEY, id, flags({ rolloutPct }), none));
      const firstOn = byPct.indexOf(true);
      expect(firstOn).toBeGreaterThan(0);
      expect(byPct.slice(firstOn).every(Boolean)).toBe(true);
    }
  });
});
