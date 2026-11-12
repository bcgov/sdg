import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { fakeConsoleApi, nestError, serviceClient } from '../../test-support/fake-console-api';
import { renderAt } from '../../test-support/render';

const REMOVE = '/api/v1/console/service-clients/billing-1';

async function openDialog() {
  const remove = await screen.findByRole('button', { name: 'Remove billing-1' });
  await userEvent.click(remove);
  const dialog = await screen.findByRole('alertdialog', { name: 'Remove billing-1?' });
  return { remove, dialog };
}

const row = () => screen.queryByRole('row', { name: /^billing-1 / });

describe('remove with confirmation (R16)', () => {
  it('asks for confirmation; Cancel leaves the row and returns focus to its Remove button', async () => {
    const api = fakeConsoleApi({ clients: [serviceClient('billing-1')] });
    renderAt('/service-clients');
    const { remove, dialog } = await openDialog();
    expect(dialog).toHaveTextContent('billing-1 display (billing-1) will no longer be able to call the gateway');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(row()).toBeInTheDocument();
    await waitFor(() => expect(remove).toHaveFocus());
    expect(api.callsTo('DELETE', REMOVE)).toEqual([]);
  });

  it('closes on Escape and keeps focus inside the dialog while open', async () => {
    fakeConsoleApi({ clients: [serviceClient('billing-1')] });
    renderAt('/service-clients');
    const { remove, dialog } = await openDialog();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    // Tab and Shift+Tab past either end of the dialog wrap around inside it.
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.tab({ shift: true });
    await userEvent.tab({ shift: true });
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(remove).toHaveFocus());
    expect(row()).toBeInTheDocument();
  });

  it('removes the row only after the API confirms, says so, and moves focus to the list', async () => {
    const api = fakeConsoleApi({ clients: [serviceClient('billing-1'), serviceClient('reports-2')] });
    renderAt('/service-clients');
    const { dialog } = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('status', { name: 'Registry updates' })).toHaveTextContent('Removed billing-1.');
    expect(row()).toBeNull();
    expect(api.callsTo('DELETE', REMOVE)).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Registered service accounts' })).toHaveFocus());
  });

  it('keeps the row and offers a retry when the removal gets a 503', async () => {
    const api = fakeConsoleApi({ clients: [serviceClient('billing-1')] });
    api.refuseNext('DELETE', REMOVE, () => nestError(503, 'Service Unavailable'));
    renderAt('/service-clients');
    const { dialog } = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The service is temporarily unavailable');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(row()).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Registry updates' })).toHaveTextContent('');

    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(row()).toBeNull());
    expect(api.callsTo('DELETE', REMOVE)).toHaveLength(2);
  });

  it('says another administrator already removed it (404) and refetches', async () => {
    const api = fakeConsoleApi({ clients: [serviceClient('billing-1')] });
    renderAt('/service-clients');
    const { dialog } = await openDialog();
    api.clients = [];
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'billing-1 was already removed by another administrator',
    );
    await waitFor(() => expect(row()).toBeNull());
    expect(await screen.findByText('No service accounts are registered yet. Add one below.')).toBeInTheDocument();
  });
});
