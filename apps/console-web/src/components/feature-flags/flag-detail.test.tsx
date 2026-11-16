import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { fakeFeatureFlagsApi, flag, flagEvent, overrideFor, person } from '../../test-support/fake-feature-flags-api';
import { renderAt } from '../../test-support/render';

const HELLO = '/api/v1/console/feature-flags/hello_world';

const details = async () => within(await screen.findByRole('region', { name: 'Flag details' }));
const updates = () => screen.getByRole('status', { name: 'Feature flag updates' });

function threeOnOverrides() {
  const people = [person('Ada', 'resident'), person('Bob', 'resident'), person('Cy', 'resident')];
  return { people, overrides: people.map((who) => overrideFor(who, true)) };
}

async function switchAndSave() {
  await userEvent.click((await details()).getByRole('switch', { name: 'On' }));
  await userEvent.click((await details()).getByRole('button', { name: 'Save changes' }));
}

describe('a flag’s page (R16, R21)', () => {
  it('opens /feature-flags/hello_world directly with its panels, notices above them, and no edit dialog', async () => {
    fakeFeatureFlagsApi({
      flags: [flag('hello_world', { description: 'The demo', enabled: true, rolloutPct: 50 })],
      events: [flagEvent(1, 'hello_world', 'created', { enabled: { from: null, to: true } })],
    });
    renderAt('/feature-flags/hello_world');
    const form = await details();
    expect(screen.getByRole('heading', { level: 1, name: 'Feature flag' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Flag details',
      'Overrides',
      'History',
      'Danger zone',
    ]);
    expect(form.getByText('hello_world')).toBeInTheDocument();
    expect(form.getByRole('textbox', { name: /Description/ })).toHaveValue('The demo');
    expect(form.getByRole('radio', { name: 'Portal' })).toBeChecked();
    expect(form.getByRole('textbox', { name: /Rollout percentage/ })).toHaveValue('50');
    expect(form.getByRole('switch', { name: 'On' })).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    const status = updates();
    expect(status.compareDocumentPosition(form.getByRole('switch')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sends a PATCH with only the rollout when only the rollout changed (KTD8)', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: true, rolloutPct: 50 })] });
    renderAt('/feature-flags/hello_world');
    const form = await details();
    const save = form.getByRole('button', { name: 'Save changes' });
    await userEvent.click(save);
    expect(form.getByText('Nothing to save: no field has changed.')).toBeInTheDocument();
    const rollout = form.getByRole('textbox', { name: /Rollout percentage/ });
    await userEvent.clear(rollout);
    await userEvent.type(rollout, '80');
    await userEvent.click(save);

    await waitFor(() => expect(updates()).toHaveTextContent('Saved hello_world.'));
    expect(api.callsTo('PATCH', HELLO).map((call) => call.body)).toEqual([{ rolloutPct: 80 }]);
    expect(api.find('hello_world')?.rolloutPct).toBe(80);
    expect((await details()).getByRole('textbox', { name: /Rollout percentage/ })).toHaveValue('80');
  });

  it('names how many people still get a flag turned off, and its link moves focus to the overrides (R21)', async () => {
    const { people, overrides } = threeOnOverrides();
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: true, overrides })], people });
    renderAt('/feature-flags/hello_world');
    await switchAndSave();

    await waitFor(() => expect(updates()).toHaveTextContent('hello_world is off, but 3 people still get it'));
    expect(api.callsTo('PATCH', HELLO).map((call) => call.body)).toEqual([{ enabled: false }]);
    await userEvent.click(within(updates()).getByRole('link', { name: 'Review the overrides' }));
    expect(screen.getByRole('region', { name: 'Overrides' })).toHaveFocus();
  });

  it('keeps the R21 notice until dismissed, and drops it when the flag is turned back on', async () => {
    const { people, overrides } = threeOnOverrides();
    fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: true, overrides })], people });
    renderAt('/feature-flags/hello_world');
    await switchAndSave();
    await waitFor(() => expect(updates()).toHaveTextContent('3 people still get it'));

    await switchAndSave();
    await waitFor(() => expect(updates()).toHaveTextContent('Saved hello_world.'));
    expect(updates()).not.toHaveTextContent('still get it');

    await switchAndSave();
    await waitFor(() => expect(updates()).toHaveTextContent('3 people still get it'));
    await userEvent.click(within(updates()).getByRole('button', { name: /close/i }));
    expect(updates()).not.toHaveTextContent('still get it');
  });

  it('shows no R21 notice when a flag with no "on" overrides is turned off', async () => {
    fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: true })] });
    renderAt('/feature-flags/hello_world');
    await switchAndSave();
    await waitFor(() => expect(updates()).toHaveTextContent('Saved hello_world.'));
    expect(updates()).not.toHaveTextContent('still get');
  });

  it('says another administrator already removed the flag (404 on save) and refetches into its deleted view', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { rolloutPct: 50 })] });
    renderAt('/feature-flags/hello_world');
    await details();
    api.flags = [];
    await switchAndSave();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'hello_world was already removed by another administrator',
    );
    expect(await screen.findByText('This flag was deleted. Its history is kept.')).toBeInTheDocument();
    expect(api.callsTo('GET', HELLO).length).toBeGreaterThan(1);
  });
});
