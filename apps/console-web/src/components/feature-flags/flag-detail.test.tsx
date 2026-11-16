import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { fakeFeatureFlagsApi, flag, flagEvent, overrideFor, person } from '../../test-support/fake-feature-flags-api';
import { renderAt } from '../../test-support/render';

const HELLO = '/api/v1/console/feature-flags/hello_world';

const updates = () => screen.getByRole('status', { name: 'Feature flag updates' });
const region = (name: string) => screen.findByRole('region', { name });
const card = async (name: string) => within(await region(name));
const patches = (api: ReturnType<typeof fakeFeatureFlagsApi>) => api.callsTo('PATCH', HELLO).map((call) => call.body);

function threeOnOverrides() {
  const people = [person('Ada', 'resident'), person('Bob', 'resident'), person('Cy', 'resident')];
  return { people, overrides: people.map((who) => overrideFor(who, true)) };
}

/** Flips the overview's switch; turning it off goes through the confirmation. */
async function flip() {
  const toggle = (await card('Switch')).getByRole('switch', { name: 'On' });
  await waitFor(() => expect(toggle).toBeEnabled());
  const wasOn = toggle.matches(':checked');
  await userEvent.click(toggle);
  if (!wasOn) return;
  const dialog = await screen.findByRole('alertdialog', { name: 'Turn hello_world off?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Turn off' }));
}

describe('a flag’s page (R16, R21)', () => {
  it('opens on its header and overview, with the notices above them', async () => {
    fakeFeatureFlagsApi({
      flags: [flag('hello_world', { description: 'The demo', enabled: true, rolloutPct: 50, overrides: [] })],
      events: [flagEvent(1, 'hello_world', 'created', { enabled: { from: null, to: true } })],
    });
    renderAt('/feature-flags/hello_world');
    const key = await screen.findByRole('heading', { level: 2, name: 'hello_world' });
    expect(screen.getByRole('heading', { level: 1, name: 'Feature flag' })).toBeInTheDocument();
    expect(screen.getByText('The demo')).toBeInTheDocument();
    expect(screen.getByText('Portal · 50% rollout · 0 forced on, 0 forced off')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect((await card('Switch')).getByRole('switch', { name: 'On' })).toBeChecked();
    expect(await region('Rollout')).toHaveTextContent('50%');
    expect(await region('Audience')).toHaveTextContent('Portal');
    expect(await region('Overrides')).toHaveTextContent('0 on · 0 off');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(updates().compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says how a person gets the flag, and lists its latest changes with a way to all of them', async () => {
    const overrides = [overrideFor(person('Ada', 'resident'), true), overrideFor(person('Bob', 'resident'), false)];
    const events = Array.from({ length: 4 }, (_, index) =>
      flagEvent(index + 1, 'hello_world', 'updated', { rollout_pct: { from: index, to: index + 1 } }),
    );
    fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: true, rolloutPct: 50, overrides })], events });
    const { router } = renderAt('/feature-flags/hello_world');
    const how = await card('How a person gets hello_world');
    expect(how.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Overrides come first: 1 person always gets it; 1 person never does.',
      'The switch is on, so everyone else goes on to the rollout.',
      'The rollout gives it to 50% of people who sign in to the portal.',
    ]);
    const recent = await card('Recent changes');
    await waitFor(() => expect(recent.getAllByRole('row')).toHaveLength(4));
    expect(recent.getAllByRole('row')[1]).toHaveTextContent('Rollout: 3% → 4%');

    await userEvent.click(recent.getByRole('link', { name: 'All history' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'history' }));
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the tab in the URL, leaving it out for the overview', async () => {
    fakeFeatureFlagsApi({ flags: [flag('hello_world')] });
    const { router } = renderAt('/feature-flags/hello_world?tab=history');
    expect(await screen.findByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    const history = await screen.findByRole('grid', { name: /^Changes to hello_world/ });
    expect(await within(history).findByText('hello_world has no history.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /^Overrides/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'overrides' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it('edits in a dialog that sends only the rollout when only the rollout changed, then closes (KTD8)', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: true, rolloutPct: 50 })] });
    renderAt('/feature-flags/hello_world');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit settings' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit hello_world' }));
    const save = dialog.getByRole('button', { name: 'Save changes' });
    await userEvent.click(save);
    expect(dialog.getByText('Nothing to save: no field has changed.')).toBeInTheDocument();
    const rollout = dialog.getByRole('textbox', { name: /Rollout percentage/ });
    await userEvent.clear(rollout);
    await userEvent.type(rollout, '80');
    await userEvent.click(save);

    await waitFor(() => expect(updates()).toHaveTextContent('Saved hello_world.'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patches(api)).toEqual([{ rolloutPct: 80 }]);
    expect(await region('Rollout')).toHaveTextContent('80%');
  });

  it('closes the edit dialog on Cancel without saving', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')] });
    renderAt('/feature-flags/hello_world');
    const edit = await screen.findByRole('button', { name: 'Edit settings' });
    await userEvent.click(edit);
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit hello_world' }));
    await userEvent.type(dialog.getByRole('textbox', { name: /Description/ }), 'Changed');
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(edit).toHaveFocus());
    expect(patches(api)).toEqual([]);
  });

  it('turns the flag on from the overview at once, and off only once confirmed', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: false })] });
    renderAt('/feature-flags/hello_world');
    await flip();
    await waitFor(() => expect(updates()).toHaveTextContent('Saved hello_world.'));
    expect(patches(api)).toEqual([{ enabled: true }]);

    const toggle = (await card('Switch')).getByRole('switch', { name: 'On' });
    await waitFor(() => expect(toggle).toBeChecked());
    await userEvent.click(toggle);
    const dialog = await screen.findByRole('alertdialog', { name: 'Turn hello_world off?' });
    expect(dialog).toHaveTextContent('Everyone else stops getting hello_world.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(toggle).toBeChecked();
    expect(patches(api)).toEqual([{ enabled: true }]);

    await flip();
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(patches(api)).toEqual([{ enabled: true }, { enabled: false }]);
  });

  it('names how many people still get a flag turned off, and its link opens the overrides (R21)', async () => {
    const { people, overrides } = threeOnOverrides();
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: true, overrides })], people });
    const { router } = renderAt('/feature-flags/hello_world');
    await userEvent.click((await card('Switch')).getByRole('switch', { name: 'On' }));
    expect(await screen.findByRole('alertdialog', { name: 'Turn hello_world off?' })).toHaveTextContent(
      'Only the 3 people with an “on” override will still get it.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));

    await waitFor(() => expect(updates()).toHaveTextContent('hello_world is off, but 3 people still get it'));
    expect(patches(api)).toEqual([{ enabled: false }]);
    await userEvent.click(within(updates()).getByRole('link', { name: 'Review the overrides' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'overrides' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Overrides' })).toHaveFocus());
  });

  it('keeps the R21 notice until dismissed, and drops it when the flag is turned back on', async () => {
    const { people, overrides } = threeOnOverrides();
    fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: true, overrides })], people });
    renderAt('/feature-flags/hello_world');
    await flip();
    await waitFor(() => expect(updates()).toHaveTextContent('3 people still get it'));

    await flip();
    await waitFor(() => expect(updates()).toHaveTextContent('Saved hello_world.'));
    expect(updates()).not.toHaveTextContent('still get it');

    await flip();
    await waitFor(() => expect(updates()).toHaveTextContent('3 people still get it'));
    await userEvent.click(within(updates()).getByRole('button', { name: /close/i }));
    expect(updates()).not.toHaveTextContent('still get it');
  });

  it('shows no R21 notice when a flag with no "on" overrides is turned off', async () => {
    fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: true })] });
    renderAt('/feature-flags/hello_world');
    await flip();
    await waitFor(() => expect(updates()).toHaveTextContent('Saved hello_world.'));
    expect(updates()).not.toHaveTextContent('still get');
  });

  it('says another administrator already removed the flag (404 on save) and refetches into its deleted view', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { rolloutPct: 50 })] });
    renderAt('/feature-flags/hello_world');
    await card('Switch');
    api.flags = [];
    await flip();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'hello_world was already removed by another administrator',
    );
    expect(await screen.findByText('This flag was deleted. Its history is kept.')).toBeInTheDocument();
    expect(api.callsTo('GET', HELLO).length).toBeGreaterThan(1);
  });
});
