import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { fakeAdminApi, nestError, serviceClient } from '../../test-support/fake-admin-api';
import { renderAt } from '../../test-support/render';

const LIST = '/api/v1/admin/service-clients';

async function fillAndSubmit(clientId: string, displayName: string) {
  const id = await screen.findByRole('textbox', { name: /Client ID/ });
  const name = screen.getByRole('textbox', { name: /Display name/ });
  if (clientId) await userEvent.type(id, clientId);
  if (displayName) await userEvent.type(name, displayName);
  await userEvent.click(screen.getByRole('button', { name: 'Add service account' }));
  return { id, name };
}

const tableRows = () => screen.queryAllByRole('row', { name: /display|Reports/ });

describe('add a service account (R16)', () => {
  it('adds the client once core-api registers it and clears the form', async () => {
    const api = fakeAdminApi();
    renderAt('/service-clients');
    const { id, name } = await fillAndSubmit('reports-1234', 'Reports team');
    expect(await screen.findByRole('row', { name: /^reports-1234 Reports team Enabled/ })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Registry updates' })).toHaveTextContent('Added reports-1234.');
    expect(api.callsTo('POST', LIST).map((call) => call.body)).toEqual([
      { clientId: 'reports-1234', displayName: 'Reports team' },
    ]);
    expect(id).toHaveValue('');
    expect(name).toHaveValue('');
  });

  it('shows an inline error for a 409, adds no row and keeps the input', async () => {
    const api = fakeAdminApi({ clients: [serviceClient('billing-1')] });
    renderAt('/service-clients');
    await screen.findByRole('row', { name: /^billing-1 / });
    const { id, name } = await fillAndSubmit('billing-1', 'Billing again');

    expect(await screen.findByText('billing-1 is already registered')).toBeInTheDocument();
    expect(id).toHaveAttribute('aria-invalid', 'true');
    expect(id).toHaveAccessibleDescription(expect.stringContaining('billing-1 is already registered'));
    expect(id).toHaveValue('billing-1');
    expect(name).toHaveValue('Billing again');
    expect(tableRows()).toHaveLength(1);
    expect(screen.getByRole('status', { name: 'Registry updates' })).toHaveTextContent('');
    expect(api.clients).toHaveLength(1);
  });

  it("shows the server's 400 reason next to its field and keeps the input", async () => {
    const api = fakeAdminApi();
    api.refuseNext('POST', LIST, () => nestError(400, ['clientId: Must be a Keycloak client id'], 'Bad Request'));
    renderAt('/service-clients');
    const { id } = await fillAndSubmit('bad/id', 'Bad');
    expect(await screen.findByText('Must be a Keycloak client id')).toBeInTheDocument();
    expect(id).toHaveAttribute('aria-invalid', 'true');
    expect(id).toHaveValue('bad/id');
    // Editing the field clears its error.
    await userEvent.type(id, 'x');
    await waitFor(() => expect(screen.queryByText('Must be a Keycloak client id')).toBeNull());
  });

  it('shows a 400 reason that names no field above the button', async () => {
    const api = fakeAdminApi();
    const reason = 'The portal and admin clients cannot be registered as service accounts';
    api.refuseNext('POST', LIST, () => nestError(400, reason, 'Bad Request'));
    renderAt('/service-clients');
    await fillAndSubmit('sdg-admin', 'Admin');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('sdg-admin was not added');
    expect(alert).toHaveTextContent(reason);
  });

  it('asks for both fields before calling admin-api', async () => {
    const api = fakeAdminApi();
    renderAt('/service-clients');
    await fillAndSubmit('', '');
    expect(await screen.findByText('Enter a client ID')).toBeInTheDocument();
    expect(screen.getByText('Enter a display name')).toBeInTheDocument();
    expect(api.callsTo('POST', LIST)).toEqual([]);
  });

  it('keeps the input and offers a retry on a 503', async () => {
    const api = fakeAdminApi();
    api.refuseNext('POST', LIST, () => nestError(503, 'Service Unavailable'));
    renderAt('/service-clients');
    const { id } = await fillAndSubmit('reports-1234', 'Reports');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The service is temporarily unavailable');
    expect(id).toHaveValue('reports-1234');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('row', { name: /^reports-1234 / })).toBeInTheDocument();
    expect(api.callsTo('POST', LIST)).toHaveLength(2);
  });
});
