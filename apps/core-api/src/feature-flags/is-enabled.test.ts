import { describe, expect, it } from 'vitest';

import { isEnabled, type FeatureFlag } from './is-enabled.js';

const KEY = 'hello_world';
// Buckets computed outside this code: sha256(`hello_world:<id>`), first 4 bytes big-endian, mod 100.
const BUCKET_23 = '00000000-0000-4000-8000-000000000001';
const BUCKET_44 = '00000000-0000-4000-8000-000000000002';

const flags = (flag: Partial<FeatureFlag> = {}) =>
  new Map([[KEY, { key: KEY, enabled: true, rolloutPct: 100, ...flag }]]);
const none = new Map<string, boolean>();

describe('isEnabled (R3)', () => {
  it.each([
    [BUCKET_23, 23, false],
    [BUCKET_23, 24, true],
    [BUCKET_44, 44, false],
    [BUCKET_44, 45, true],
  ])('Should put %s in a fixed bucket, so a %i percent rollout gives %s', (id, rolloutPct, expected) => {
    expect(isEnabled(KEY, id, flags({ rolloutPct }), none)).toBe(expected);
  });

  it('Should return false for a disabled or missing flag whatever the override says (kill switch)', () => {
    const on = new Map([[`${KEY}:${BUCKET_44}`, true]]);
    expect(isEnabled(KEY, BUCKET_44, flags({ enabled: false }), on)).toBe(false);
    expect(isEnabled(KEY, BUCKET_44, new Map(), on)).toBe(false);
    const off = new Map([[`${KEY}:${BUCKET_44}`, false]]);
    expect(isEnabled(KEY, BUCKET_44, flags({ enabled: false }), off)).toBe(false);
  });

  it('Should let an override decide over the rollout while the flag is on', () => {
    const on = new Map([[`${KEY}:${BUCKET_44}`, true]]);
    expect(isEnabled(KEY, BUCKET_44, flags({ rolloutPct: 0 }), on)).toBe(true);
    const off = new Map([[`${KEY}:${BUCKET_44}`, false]]);
    expect(isEnabled(KEY, BUCKET_44, flags({ rolloutPct: 100 }), off)).toBe(false);
  });

  it('Should return false for a disabled flag with no override', () => {
    expect(isEnabled(KEY, BUCKET_44, flags({ enabled: false }), none)).toBe(false);
    expect(isEnabled(KEY, BUCKET_44, new Map(), none)).toBe(false);
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
