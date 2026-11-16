import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { fakeFeatureFlagsApi, flag, overrideFor, person } from '../../test-support/fake-feature-flags-api';
import { renderAt } from '../../test-support/render';

const SEARCH = '/api/v1/console/people/search';

const overridesRegion = () => screen.findByRole('region', { name: 'Overrides' });
const updates = () => screen.getByRole('status', { name: 'Feature flag updates' });

async function searchFor(text: string) {
  await userEvent.type(within(await overridesRegion()).getByRole('searchbox', { name: /Find a person/ }), text);
}

describe('overrides (R18, R21)', () => {
  it('sets an override for a person found by search, updating the panel and the counts', async () => {
    const grace = person('Grace Hopper', 'resident');
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')], people: [grace] });
    renderAt('/feature-flags/hello_world');
    await searchFor('grace');
    await userEvent.click(await screen.findByRole('button', { name: /^Grace Hopper/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Turn on for Grace Hopper' }));

    await waitFor(() => expect(updates()).toHaveTextContent('hello_world is now on for Grace Hopper.'));
    const region = await overridesRegion();
    expect(within(region).getByRole('row', { name: /^Grace Hopper / })).toHaveTextContent('ResidentOn');
    expect(region).toHaveTextContent('Forced on for 1 person and off for 0 people.');
    expect(screen.queryByRole('button', { name: 'Turn on for Grace Hopper' })).toBeNull();
    expect(api.find('hello_world')?.overrideCounts).toEqual({ on: 1, off: 0 });

    await userEvent.click(screen.getByRole('link', { name: 'All feature flags' }));
    const row = (await screen.findByRole('rowheader', { name: 'hello_world' })).closest('[role="row"]');
    expect(row).toHaveTextContent('1 on, 0 off');
  });

  it('removes an override, updating the panel and the counts', async () => {
    const ada = person('Ada', 'resident');
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { overrides: [overrideFor(ada, false)] })] });
    renderAt('/feature-flags/hello_world');
    const region = await overridesRegion();
    expect(region).toHaveTextContent('Forced on for 0 people and off for 1 person.');
    await userEvent.click(within(region).getByRole('button', { name: 'Remove the override for Ada' }));

    await waitFor(() => expect(updates()).toHaveTextContent('Removed the override for Ada.'));
    expect(region).toHaveTextContent('No one has an override for hello_world.');
    expect(region).toHaveTextContent('Forced on for 0 people and off for 0 people.');
    expect(api.find('hello_world')?.overrides).toEqual([]);
  });

  it('says another administrator removed an override already (404) and refetches', async () => {
    const ada = person('Ada', 'resident');
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { overrides: [overrideFor(ada, true)] })] });
    renderAt('/feature-flags/hello_world');
    const region = await overridesRegion();
    api.flags = [flag('hello_world')];
    await userEvent.click(within(region).getByRole('button', { name: 'Remove the override for Ada' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The override for Ada was already removed by another administrator',
    );
    await waitFor(() => expect(region).toHaveTextContent('No one has an override for hello_world.'));
  });

  it('searches a console flag among console users only, labelled as such (AE10)', async () => {
    const cy = person('Cyrus Admin', 'console-user');
    const api = fakeFeatureFlagsApi({
      flags: [flag('new_console', { audience: 'console', rolloutPct: 0 })],
      people: [cy, person('Cyrus Resident', 'resident')],
    });
    renderAt('/feature-flags/new_console');
    await searchFor('cyrus');

    const results = await screen.findByRole('list', { name: 'People found' });
    expect(
      within(results)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([expect.stringMatching(/^Cyrus Admin.*Console user, last signed in/)]);
    expect(api.callsTo('POST', SEARCH).map((call) => call.body)).toEqual([{ query: 'cyrus', audience: 'console' }]);

    await userEvent.click(within(results).getByRole('button', { name: /^Cyrus Admin/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Turn on for Cyrus Admin' }));
    await waitFor(() => expect(updates()).toHaveTextContent('new_console is now on for Cyrus Admin.'));
    expect(api.find('new_console')?.overrides).toEqual([overrideFor(cy, true)]);
  });
});
