import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { fakeFeatureFlagsApi, flag } from '../../test-support/fake-feature-flags-api';
import { renderAt } from '../../test-support/render';

const LIST = '/api/v1/console/feature-flags';

/** Opens the create dialog from the landing page's button. */
async function openCreate() {
  const opener = await screen.findByRole('button', { name: 'Create feature flag' });
  await userEvent.click(opener);
  const dialog = await screen.findByRole('dialog', { name: 'Create a feature flag' });
  return { opener, dialog, form: within(dialog) };
}

describe('create a feature flag in a dialog (R15, KTD12, KTD13)', () => {
  it('opens a dialog that starts off, for the portal, at 0%', async () => {
    fakeFeatureFlagsApi();
    renderAt('/feature-flags');
    const { form } = await openCreate();
    expect(form.getByRole('textbox', { name: /Rollout percentage/ })).toHaveValue('0');
    expect(form.getByRole('radio', { name: 'Portal' })).toBeChecked();
    expect(form.getByRole('switch', { name: 'On' })).not.toBeChecked();
  });

  it('creates the flag with the rollout sent as 0, closes the dialog, adds the row and says so', async () => {
    const api = fakeFeatureFlagsApi();
    renderAt('/feature-flags');
    const { form } = await openCreate();
    await userEvent.type(form.getByRole('textbox', { name: /Key/ }), 'new_search');
    await userEvent.type(form.getByRole('textbox', { name: /Description/ }), '  The new search page ');
    await userEvent.click(form.getByRole('radio', { name: 'Console' }));
    await userEvent.click(form.getByRole('button', { name: 'Create feature flag' }));

    const row = (await screen.findByRole('rowheader', { name: 'new_search' })).closest('[role="row"]');
    expect(row).toHaveTextContent('new_searchConsoleOff0%0 on, 0 off');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status', { name: 'Feature flag updates' })).toHaveTextContent('Created new_search.');
    expect(api.callsTo('POST', LIST).map((call) => call.body)).toEqual([
      { key: 'new_search', description: 'The new search page', enabled: false, rolloutPct: 0, audience: 'console' },
    ]);
  });

  it('rejects a key like Hello before calling console-api', async () => {
    const api = fakeFeatureFlagsApi();
    renderAt('/feature-flags');
    const { form } = await openCreate();
    const key = form.getByRole('textbox', { name: /Key/ });
    await userEvent.type(key, 'Hello');
    await userEvent.click(form.getByRole('button', { name: 'Create feature flag' }));

    expect(await form.findByText(/Use 2 to 63 lower-case letters/)).toBeInTheDocument();
    expect(key).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST', LIST)).toEqual([]);
  });

  it("shows the server's 409 for a duplicate key next to the field and keeps the dialog and input", async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')] });
    renderAt('/feature-flags');
    await screen.findByRole('rowheader', { name: 'hello_world' });
    const { form } = await openCreate();
    const key = form.getByRole('textbox', { name: /Key/ });
    await userEvent.type(key, 'hello_world');
    await userEvent.click(form.getByRole('button', { name: 'Create feature flag' }));

    expect(await form.findByText('Feature flag hello_world already exists')).toBeInTheDocument();
    expect(key).toHaveAttribute('aria-invalid', 'true');
    expect(key).toHaveValue('hello_world');
    expect(api.flags).toHaveLength(1);
  });

  it('closes on Cancel and on Escape without creating, returning focus to the button', async () => {
    const api = fakeFeatureFlagsApi();
    renderAt('/feature-flags');
    const first = await openCreate();
    await userEvent.click(first.form.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(first.opener).toHaveFocus());

    await openCreate();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.callsTo('POST', LIST)).toEqual([]);
  });
});
