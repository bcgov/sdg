import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { nestError } from '../../test-support/fake-console-api';
import { fakeFeatureFlagsApi, flag, overrideFor, person } from '../../test-support/fake-feature-flags-api';
import { renderAt } from '../../test-support/render';

const HELLO = '/api/v1/console/feature-flags/hello_world';

async function openDialog() {
  const dangerZone = await screen.findByRole('region', { name: 'Danger zone' });
  const remove = within(dangerZone).getByRole('button', { name: 'Delete hello_world' });
  await userEvent.click(remove);
  return { remove, dialog: await screen.findByRole('alertdialog', { name: 'Delete hello_world?' }) };
}

function withOverrides() {
  const overrides = [overrideFor(person('Ada', 'resident'), true), overrideFor(person('Bob', 'resident'), false)];
  return fakeFeatureFlagsApi({ flags: [flag('hello_world', { overrides }), flag('other_flag')] });
}

describe('delete a flag from its page, with confirmation (R17, R19)', () => {
  it('names the key and its override count, and says the history is kept; Cancel deletes nothing', async () => {
    const api = withOverrides();
    renderAt('/feature-flags/hello_world');
    const { remove, dialog } = await openDialog();
    expect(dialog).toHaveTextContent('hello_world and its 2 overrides will be deleted');
    expect(dialog).toHaveTextContent('Its history is kept.');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(remove).toHaveFocus());
    expect(api.callsTo('DELETE', HELLO)).toEqual([]);
  });

  it('deletes once core-api confirms, then goes back to the list, which says so and has no row for it', async () => {
    const api = withOverrides();
    const { router } = renderAt('/feature-flags/hello_world');
    const { dialog } = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/feature-flags'));
    expect(await screen.findByRole('row', { name: /^other_flag / })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /^hello_world / })).toBeNull();
    expect(screen.getByRole('status', { name: 'Feature flag updates' })).toHaveTextContent('Deleted hello_world.');
    expect(api.callsTo('DELETE', HELLO)).toHaveLength(1);
    expect(api.find('hello_world')).toBeUndefined();
  });

  it('stays on the page and offers a retry when the delete gets a 503', async () => {
    const api = withOverrides();
    api.refuseNext('DELETE', HELLO, () => nestError(503, 'Service Unavailable'));
    const { router } = renderAt('/feature-flags/hello_world');
    const { dialog } = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nothing was changed for hello_world');
    expect(router.state.location.pathname).toBe('/feature-flags/hello_world');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/feature-flags'));
  });

  it('says another administrator already removed it (404) and shows its deleted view', async () => {
    const api = withOverrides();
    renderAt('/feature-flags/hello_world');
    const { dialog } = await openDialog();
    api.flags = api.flags.filter(({ key }) => key !== 'hello_world');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'hello_world was already removed by another administrator',
    );
    expect(await screen.findByText('This flag was deleted. Its history is kept.')).toBeInTheDocument();
  });
});
