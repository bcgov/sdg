import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { currentUserQueryKey } from '../../auth/use-current-user';
import { fakeConsoleApi, nestError, serviceClient } from '../../test-support/fake-console-api';
import { renderAt } from '../../test-support/render';

const LIST = '/api/v1/console/service-clients';

async function findTable() {
  return screen.findByRole('table', { name: 'Clients the gateway accepts while enabled' });
}

describe('registry list (R16)', () => {
  it('lists every registered client with its status and actions named with its client id', async () => {
    fakeConsoleApi({ clients: [serviceClient('billing-1'), serviceClient('reports-2', { enabled: false })] });
    renderAt('/service-clients');
    const rows = within(await findTable()).getAllByRole('row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Client IDDisplay nameStatusActions',
      'billing-1billing-1 displayEnabledDisableRemove',
      'reports-2reports-2 displayDisabledEnableRemove',
    ]);
    expect(screen.getByRole('button', { name: 'Disable billing-1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable reports-2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove reports-2' })).toBeInTheDocument();
  });

  it('says none are registered yet in a fresh environment', async () => {
    fakeConsoleApi();
    renderAt('/service-clients');
    expect(await screen.findByText('No service accounts are registered yet. Add one below.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /Clients the gateway accepts/ })).toBeNull();
  });

  it('offers a retry when the list cannot be loaded (503), and stays on the page', async () => {
    const api = fakeConsoleApi({ clients: [serviceClient('billing-1')] });
    api.refuseNext('GET', LIST, () => nestError(503, 'Service Unavailable'));
    const { router } = renderAt('/service-clients');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The service is temporarily unavailable');
    expect(alert).toHaveTextContent("The service accounts couldn't be loaded");
    expect(router.state.location.pathname).toBe('/service-clients');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('row', { name: /billing-1/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('returns to the sign-in card with "session ended" when console-api answers 401 during a list load (AE3)', async () => {
    const api = fakeConsoleApi({ clients: [serviceClient('billing-1')] });
    api.refuseNext('GET', LIST, () => nestError(401, 'Unauthorized'));
    const { router, queryClient } = renderAt('/service-clients');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your session ended');
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ session: 'ended', returnTo: '/service-clients' });
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2Fservice-clients',
    );
    expect(queryClient.getQueryData(currentUserQueryKey)).toBeNull();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2Fservice-clients',
    );
  });

  it('keeps the page the administrator was on when every registry call answers 401', async () => {
    const api = fakeConsoleApi({ clients: [serviceClient('billing-1')] });
    api.refuseNext('GET', LIST, () => nestError(401, 'Unauthorized'));
    api.refuseNext('GET', `${LIST}/history`, () => nestError(401, 'Unauthorized'));
    const { router } = renderAt('/service-clients');
    expect(await screen.findByRole('alert')).toHaveTextContent('Your session ended');
    await waitFor(() => expect(api.callsTo('GET', `${LIST}/history`)).toHaveLength(1));
    expect(router.state.location.search).toEqual({ session: 'ended', returnTo: '/service-clients' });
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2Fservice-clients',
    );
  });

  it('shows the not-authorized page when core-api refuses the administrator (403)', async () => {
    const api = fakeConsoleApi();
    api.refuseNext('GET', LIST, () => nestError(403, 'Forbidden'));
    const { router } = renderAt('/service-clients');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'You are not authorized to use SDG Console' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/not-authorized');
  });

  it('sends a signed-out visitor to the sign-in card and calls no registry route', async () => {
    const api = fakeConsoleApi({ signedIn: false });
    const { router } = renderAt('/service-clients');
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2Fservice-clients',
    );
    expect(router.state.location.pathname).toBe('/login');
    await waitFor(() => expect(api.callsTo('GET', '/api/auth/me')).toHaveLength(1));
    expect(api.calls.filter((call) => call.path.startsWith(LIST))).toEqual([]);
  });
});
