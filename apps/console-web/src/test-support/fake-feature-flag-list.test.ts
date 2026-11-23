import { describe, expect, it } from 'vitest';

import { flagHistoryPage, flagListPage } from './fake-feature-flag-list';
import { flag, flagEvent, person } from './fake-feature-flags-api';

describe('fake-feature-flag-list', () => {
  it('Should sort, tie-break by key in both directions, filter, and clamp offset in flagListPage', () => {
    const ada = person('Ada', 'resident');
    const flags = [
      flag('zeta', {
        enabled: true,
        audience: 'portal',
        description: 'portal flag',
        overrides: [
          { principalId: ada.principalId, name: ada.displayName, email: ada.email, kind: ada.kind, enabled: true },
        ],
      }),
      flag('alpha', { enabled: true, audience: 'both', description: null, rolloutPct: 50 }),
      flag('beta', { enabled: false, audience: 'console', description: 'console flag', rolloutPct: 10 }),
    ];

    // Default query: sort by key asc, no filters
    const defaultPage = flagListPage(flags, new URLSearchParams());
    expect(defaultPage.items.map((f) => f.key)).toEqual(['alpha', 'beta', 'zeta']);

    // Sort by enabled (both true for alpha & zeta -> hits line 51 tie-break a.key < b.key in both directions)
    const byEnabled = flagListPage(flags, new URLSearchParams('sort=enabled&order=asc&limit=2&offset=10'));
    expect(byEnabled.offset).toBe(2);
    expect(byEnabled.items.map((f) => f.key)).toEqual(['zeta']);

    // Sort by overridesOn and unknown sort column fallback
    expect(flagListPage(flags, new URLSearchParams('sort=overridesOn')).items[0]?.key).toBe('zeta');
    expect(flagListPage(flags, new URLSearchParams('sort=unknown')).items.map((f) => f.key)).toEqual([
      'alpha',
      'beta',
      'zeta',
    ]);

    // Filter by q (matching description, null description), audience, and enabled
    expect(flagListPage(flags, new URLSearchParams('q=portal&audience=portal&enabled=true')).total).toBe(1);
    expect(flagListPage(flags, new URLSearchParams('q=alpha&audience=portal')).total).toBe(1);
    expect(flagListPage(flags, new URLSearchParams('q=nonexistent')).total).toBe(0);
  });

  it('Should page flagHistoryPage with after (with and without older), before, key, and empty results', () => {
    const events = [
      flagEvent(1, 'alpha', 'created'),
      flagEvent(2, 'alpha', 'updated'),
      flagEvent(3, 'alpha', 'updated'),
      flagEvent(4, 'alpha', 'updated'),
      flagEvent(5, 'beta', 'created'),
    ];

    // Default newest page
    const newest = flagHistoryPage(events, new URLSearchParams('limit=2'));
    expect(newest.items.map((e) => e.id)).toEqual([5, 4]);
    expect(newest.older).toBe(4);
    expect(newest.newer).toBeNull();

    // `after` with newer.length > limit and older events existing (lines 69-72, older !== null)
    const afterWithOlder = flagHistoryPage(events, new URLSearchParams('key=alpha&limit=2&after=1'));
    expect(afterWithOlder.items.map((e) => e.id)).toEqual([3, 2]);
    expect(afterWithOlder.older).toBe(2);
    expect(afterWithOlder.newer).toBe(3);

    // `after` with newer.length > limit and NO older events (lines 69-72, older === null)
    const afterAtStart = flagHistoryPage(events, new URLSearchParams('key=alpha&limit=2&after=0'));
    expect(afterAtStart.items.map((e) => e.id)).toEqual([2, 1]);
    expect(afterAtStart.older).toBeNull();
    expect(afterAtStart.newer).toBe(2);

    // `after` reaching the newest events falls back to newest page
    const afterAtEnd = flagHistoryPage(events, new URLSearchParams('key=alpha&limit=2&after=3'));
    expect(afterAtEnd.items.map((e) => e.id)).toEqual([4, 3]);
    expect(afterAtEnd.newer).toBeNull();

    // `before` with newer events existing and no older events left
    const beforeMiddle = flagHistoryPage(events, new URLSearchParams('key=alpha&limit=2&before=3'));
    expect(beforeMiddle.items.map((e) => e.id)).toEqual([2, 1]);
    expect(beforeMiddle.older).toBeNull();
    expect(beforeMiddle.newer).toBe(2);

    // `before` past the oldest event -> empty page
    expect(flagHistoryPage(events, new URLSearchParams('before=1'))).toEqual({ items: [], older: null, newer: null });

    // Default limit when omitted
    expect(flagHistoryPage(events, new URLSearchParams()).items).toHaveLength(5);
  });
});
