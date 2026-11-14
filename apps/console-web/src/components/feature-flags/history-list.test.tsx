import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { fakeFeatureFlagsApi, flag, flagEvent } from '../../test-support/fake-feature-flags-api';
import { renderAt } from '../../test-support/render';

const HISTORY = '/api/v1/console/feature-flag-history';
const GRACE = { principalId: '00000000-0000-4000-8000-0000000000aa', name: 'Grace Hopper' };

const items = async () =>
  within(await screen.findByRole('list', { name: 'Changes to hello_world, newest first' }))
    .getAllByRole('listitem')
    // Each item starts with its time and ': '.
    .map((item) => item.textContent?.slice((item.querySelector('time')?.textContent ?? '').length + 2));

describe('a flag’s history (R19)', () => {
  it('lists its changes newest first, with what changed, for whom and by whom', async () => {
    fakeFeatureFlagsApi({
      flags: [flag('hello_world')],
      events: [
        flagEvent(1, 'hello_world', 'created', {
          enabled: { from: null, to: false },
          rollout_pct: { from: null, to: 0 },
        }),
        flagEvent(2, 'hello_world', 'override_set', { enabled: { from: null, to: true } }, GRACE),
        flagEvent(3, 'other_flag', 'created', { enabled: { from: null, to: true } }),
        flagEvent(4, 'hello_world', 'updated', {
          rollout_pct: { from: 0, to: 80 },
          audience: { from: 'portal', to: 'both' },
        }),
      ],
    });
    renderAt('/feature-flags/hello_world');
    expect(await items()).toEqual([
      'Updated by Ada Lovelace. Rollout: 0% → 80%; Audience: Portal → Portal and console',
      'Override set for Grace Hopper by Ada Lovelace. Override: on',
      'Created by Ada Lovelace. Switch: off; Rollout: 0%',
    ]);
    const list = screen.getByRole('list', { name: 'Changes to hello_world, newest first' });
    const time = within(list).getAllByRole('listitem')[0]!.querySelector('time');
    expect(time).toHaveAttribute('dateTime', '2026-11-10T17:04:00.000Z');
  });

  it('pages older changes with "Load more history" using nextBefore', async () => {
    const events = Array.from({ length: 25 }, (_, i) =>
      flagEvent(i + 1, 'hello_world', 'updated', { rollout_pct: { from: i, to: i + 1 } }),
    );
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')], events });
    renderAt('/feature-flags/hello_world');
    expect(await items()).toHaveLength(20);
    await userEvent.click(screen.getByRole('button', { name: 'Load more history' }));

    await waitFor(async () => expect(await items()).toHaveLength(25));
    expect(api.callsTo('GET', HISTORY).map((call) => call.path)).toEqual([
      `${HISTORY}?limit=20&key=hello_world`,
      `${HISTORY}?limit=20&key=hello_world&before=6`,
    ]);
    expect(screen.getByText('Showing 25 changes.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more history' })).toBeNull();
  });

  it('adds a change made on the page to the top of the history', async () => {
    fakeFeatureFlagsApi({ flags: [flag('hello_world')] });
    renderAt('/feature-flags/hello_world');
    expect(await screen.findByText('hello_world has no history.')).toBeInTheDocument();
    const details = within(await screen.findByRole('region', { name: 'Flag details' }));
    await userEvent.click(details.getByRole('switch', { name: 'On' }));
    await userEvent.click(details.getByRole('button', { name: 'Save changes' }));
    await waitFor(async () => expect(await items()).toEqual(['Updated by Ada Lovelace. Switch: off → on']));
  });
});
