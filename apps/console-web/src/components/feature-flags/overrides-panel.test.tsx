import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { fakeFeatureFlagsApi, flag, overrideFor, person } from '../../test-support/fake-feature-flags-api';
import { renderAt } from '../../test-support/render';

const SEARCH = '/api/v1/console/people/search';

const overridesRegion = () => screen.findByRole('region', { name: 'Overrides' });
const updates = () => screen.getByRole('status', { name: 'Feature flag updates' });
/** The header's override counts ("1 forced on, 0 forced off"). */
const counts = () => screen.getByText(/\d+ forced on, \d+ forced off$/);
const overridesGrid = async () => within(await overridesRegion()).findByRole('grid', { name: /^Overrides of / });
const names = async () =>
  within(await overridesGrid())
    .queryAllByRole('rowheader')
    .map((cell) => cell.textContent);
const rowOf = async (name: string) =>
  (await within(await overridesGrid()).findByRole('rowheader', { name })).closest('[role="row"]');

/** Opens the dialog from the panel and types into its people search. */
async function searchFor(text: string) {
  await userEvent.click(within(await overridesRegion()).getByRole('button', { name: 'Add or change an override' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add or change an override' });
  await userEvent.type(within(dialog).getByRole('searchbox', { name: /Find a person/ }), text);
  return dialog;
}

describe('overrides (R18, R21)', () => {
  it('sets an override for a person found in the dialog, closing it and updating the table and the counts', async () => {
    const grace = person('Grace Hopper', 'resident');
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')], people: [grace] });
    renderAt('/feature-flags/hello_world?tab=overrides');
    const dialog = await searchFor('grace');
    await userEvent.click(await within(dialog).findByRole('button', { name: /^Grace Hopper/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn on for Grace Hopper' }));

    await waitFor(() => expect(updates()).toHaveTextContent('hello_world is now on for Grace Hopper.'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await rowOf('Grace Hopper')).toHaveTextContent('Grace Hoppergrace.hopper@example.testResidentOnRemove');
    expect(counts()).toHaveTextContent('1 forced on, 0 forced off');
    expect(api.find('hello_world')?.overrideCounts).toEqual({ on: 1, off: 0 });

    await userEvent.click(screen.getByRole('link', { name: 'All feature flags' }));
    const row = (await screen.findByRole('rowheader', { name: 'hello_world' })).closest('[role="row"]');
    expect(row).toHaveTextContent('1 on, 0 off');
  });

  it('goes back to the search from a chosen person, and Cancel closes the dialog without a change', async () => {
    const grace = person('Grace Hopper', 'resident');
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')], people: [grace] });
    renderAt('/feature-flags/hello_world?tab=overrides');
    const dialog = await searchFor('grace');
    await userEvent.click(await within(dialog).findByRole('button', { name: /^Grace Hopper/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Choose someone else' }));
    expect(within(dialog).getByRole('searchbox', { name: /Find a person/ })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add or change an override' })).toHaveFocus());
    expect(api.find('hello_world')?.overrides).toEqual([]);
  });

  it('removes an override, updating the table and the counts', async () => {
    const ada = person('Ada', 'resident');
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { overrides: [overrideFor(ada, false)] })] });
    renderAt('/feature-flags/hello_world?tab=overrides');
    const region = await overridesRegion();
    expect(counts()).toHaveTextContent('0 forced on, 1 forced off');
    await userEvent.click(await within(region).findByRole('button', { name: 'Remove the override for Ada' }));

    await waitFor(() => expect(updates()).toHaveTextContent('Removed the override for Ada.'));
    expect(region).toHaveTextContent('No one has an override for hello_world.');
    await waitFor(() => expect(counts()).toHaveTextContent('0 forced on, 0 forced off'));
    expect(api.find('hello_world')?.overrides).toEqual([]);
  });

  it('says another administrator removed an override already (404) and refetches', async () => {
    const ada = person('Ada', 'resident');
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { overrides: [overrideFor(ada, true)] })] });
    renderAt('/feature-flags/hello_world?tab=overrides');
    const region = await overridesRegion();
    api.flags = [flag('hello_world')];
    await userEvent.click(await within(region).findByRole('button', { name: 'Remove the override for Ada' }));

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
    renderAt('/feature-flags/new_console?tab=overrides');
    const dialog = await searchFor('cyrus');

    const results = await within(dialog).findByRole('list', { name: 'People found' });
    expect(
      within(results)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([expect.stringMatching(/^Cyrus Admin.*Console user, last signed in/)]);
    expect(api.callsTo('POST', SEARCH).map((call) => call.body)).toEqual([{ query: 'cyrus', audience: 'console' }]);

    await userEvent.click(within(results).getByRole('button', { name: /^Cyrus Admin/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn on for Cyrus Admin' }));
    await waitFor(() => expect(updates()).toHaveTextContent('new_console is now on for Cyrus Admin.'));
    expect(api.find('new_console')?.overrides).toEqual([overrideFor(cy, true)]);
  });
});

/** 25 overrides, Person 01 to Person 25, the odd ones on and every fifth a console user. */
const many = () =>
  Array.from({ length: 25 }, (_, index) =>
    overrideFor(
      person(`Person ${String(index + 1).padStart(2, '0')}`, index % 5 === 4 ? 'console-user' : 'resident'),
      index % 2 === 0,
    ),
  );

describe('the overrides table (R18)', () => {
  it('pages by name 20 at a time, with the page in its o. params', async () => {
    fakeFeatureFlagsApi({ flags: [flag('hello_world', { audience: 'both', overrides: many() })] });
    const { router } = renderAt('/feature-flags/hello_world?tab=overrides');
    expect(await names()).toHaveLength(20);
    expect((await names())[0]).toBe('Person 01');
    await userEvent.click(within(await overridesRegion()).getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'overrides', 'o.page': '2' }));
    expect(await names()).toEqual(['Person 21', 'Person 22', 'Person 23', 'Person 24', 'Person 25']);
  });

  it('searches, filters and sorts from the URL, beside the list and history params', async () => {
    fakeFeatureFlagsApi({ flags: [flag('hello_world', { audience: 'both', overrides: many() })] });
    renderAt(
      '/feature-flags/hello_world?tab=overrides&enabled=false&o.q=person%201&o.enabled=true&o.sort=name&o.order=desc&h.pageSize=10',
    );
    // Person 10–19 match "person 1"; the odd-numbered ones (index even) are on.
    expect(await names()).toEqual(['Person 19', 'Person 17', 'Person 15', 'Person 13', 'Person 11']);
  });

  it('filters by kind, and says when nothing matches', async () => {
    fakeFeatureFlagsApi({ flags: [flag('hello_world', { audience: 'both', overrides: many() })] });
    const { router } = renderAt('/feature-flags/hello_world?tab=overrides&o.kind=console-user');
    expect(await names()).toEqual(['Person 05', 'Person 10', 'Person 15', 'Person 20', 'Person 25']);

    await router.navigate({
      to: '/feature-flags/$key',
      params: { key: 'hello_world' },
      search: { tab: 'overrides', 'o.q': 'nobody' },
    });
    expect(await within(await overridesGrid()).findByText('No overrides match the search or filters.')).toBeVisible();
  });

  it('replaces a page past the end with the last page (R14)', async () => {
    fakeFeatureFlagsApi({ flags: [flag('hello_world', { audience: 'both', overrides: many() })] });
    const { router } = renderAt('/feature-flags/hello_world?tab=overrides&o.page=9');
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'overrides', 'o.page': '2' }));
    expect(await names()).toHaveLength(5);
  });
});
