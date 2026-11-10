import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ORIGIN_REFUSAL_MESSAGE } from '../../api/http';
import { fakeAdminApi, nestError, serviceClient } from '../../test-support/fake-admin-api';
import { renderAt } from '../../test-support/render';

const DISABLE = '/api/v1/admin/service-clients/billing-1/disable';

const originalLocation = window.location;

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: originalLocation });
  vi.restoreAllMocks();
});

function updates() {
  return screen.getByRole('status', { name: 'Registry updates' });
}

async function findRow(clientId: string) {
  return screen.findByRole('row', { name: new RegExp(`^${clientId} `) });
}

describe('disable and re-enable (R16, R32)', () => {
  it('disables a client only once core-api confirms, then offers to re-enable it', async () => {
    const api = fakeAdminApi({ clients: [serviceClient('billing-1')] });
    renderAt('/service-clients');
    await userEvent.click(await screen.findByRole('button', { name: 'Disable billing-1' }));
    await waitFor(() => expect(updates()).toHaveTextContent('Disabled billing-1.'));
    expect(within(await findRow('billing-1')).getByRole('cell', { name: 'Disabled' })).toBeInTheDocument();
    expect(api.callsTo('POST', DISABLE)).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Enable billing-1' }));
    await waitFor(() => expect(updates()).toHaveTextContent('Enabled billing-1.'));
    expect(within(await findRow('billing-1')).getByRole('cell', { name: 'Enabled' })).toBeInTheDocument();
    expect(api.clients[0]?.enabled).toBe(true);
  });

  it('keeps the row enabled and offers a retry when admin-api answers 503 on disable', async () => {
    const api = fakeAdminApi({ clients: [serviceClient('billing-1')] });
    api.refuseNext('POST', DISABLE, () => nestError(503, 'Service Unavailable'));
    const { router } = renderAt('/service-clients');
    await userEvent.click(await screen.findByRole('button', { name: 'Disable billing-1' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The service is temporarily unavailable');
    expect(alert).toHaveTextContent('Nothing was changed for billing-1');
    expect(within(await findRow('billing-1')).getByRole('cell', { name: 'Enabled' })).toBeInTheDocument();
    expect(updates()).toHaveTextContent('');
    expect(router.state.location.pathname).toBe('/service-clients');

    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(updates()).toHaveTextContent('Disabled billing-1.'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.callsTo('POST', DISABLE)).toHaveLength(2);
  });

  it("shows a blocked request, not the not-authorized page, for the origin guard's 403", async () => {
    const api = fakeAdminApi({ clients: [serviceClient('billing-1')] });
    api.refuseNext('POST', DISABLE, () => nestError(403, ORIGIN_REFUSAL_MESSAGE, 'Forbidden'));
    const reload = vi.fn<() => void>();
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { reload } });
    const { router } = renderAt('/service-clients');
    await userEvent.click(await screen.findByRole('button', { name: 'Disable billing-1' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The request was blocked');
    expect(router.state.location.pathname).toBe('/service-clients');
    expect(within(await findRow('billing-1')).getByRole('cell', { name: 'Enabled' })).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: 'Reload the page' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('says another administrator already removed the client (404) and refetches the registry', async () => {
    const api = fakeAdminApi({ clients: [serviceClient('billing-1'), serviceClient('reports-2')] });
    renderAt('/service-clients');
    await findRow('billing-1');
    const listLoads = api.callsTo('GET', '/api/v1/admin/service-clients').length;
    api.clients = api.clients.filter(({ clientId }) => clientId !== 'billing-1');

    await userEvent.click(screen.getByRole('button', { name: 'Disable billing-1' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'billing-1 was already removed by another administrator',
    );
    await waitFor(() => expect(screen.queryByRole('row', { name: /^billing-1 / })).toBeNull());
    expect(api.callsTo('GET', '/api/v1/admin/service-clients').length).toBeGreaterThan(listLoads);
    expect(await findRow('reports-2')).toBeInTheDocument();
  });
});
