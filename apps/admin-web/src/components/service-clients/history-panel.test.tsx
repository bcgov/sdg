import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { ServiceClientAction, ServiceClientEvent } from '../../api/service-clients';
import { ADMIN, fakeAdminApi, nestError, serviceClient } from '../../test-support/fake-admin-api';
import { renderAt } from '../../test-support/render';

const HISTORY = '/api/v1/admin/service-clients/history';

function event(id: number, clientId: string, action: ServiceClientAction, name = ADMIN.name): ServiceClientEvent {
  const createdAt = new Date(Date.parse('2026-11-02T18:00:00.000Z') + id * 60_000).toISOString();
  return { id, clientId, action, actor: { principalId: ADMIN.id, name }, createdAt };
}

const findHistory = () => screen.findByRole('table', { name: /Every change to the registry/ });

describe('registry history (R17)', () => {
  it('lists events newest first with actor names and times, including removed clients', async () => {
    fakeAdminApi({
      clients: [serviceClient('billing-1')],
      events: [
        event(1, 'old-client', 'added', 'Grace Hopper'),
        event(2, 'old-client', 'removed'),
        event(3, 'billing-1', 'added'),
      ],
    });
    renderAt('/service-clients');
    const rows = within(await findHistory())
      .getAllByRole('row')
      .slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .slice(1)
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ['billing-1', 'Added', 'Ada Lovelace'],
      ['old-client', 'Removed', 'Ada Lovelace'],
      ['old-client', 'Added', 'Grace Hopper'],
    ]);
    const time = rows[0]!.querySelector('time');
    expect(time).toHaveAttribute('dateTime', '2026-11-02T18:03:00.000Z');
    expect(time?.textContent).toMatch(/2026/);
    expect(screen.getByText('Showing 3 changes.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more history' })).toBeNull();
  });

  it('pages older events with "load more" using nextBefore', async () => {
    const events = Array.from({ length: 25 }, (_, i) => event(i + 1, `client-${i + 1}`, 'added'));
    const api = fakeAdminApi({ events });
    renderAt('/service-clients');
    expect(within(await findHistory()).getAllByRole('row')).toHaveLength(21);
    expect(api.callsTo('GET', HISTORY).map((call) => call.path)).toEqual([`${HISTORY}?limit=20`]);

    await userEvent.click(screen.getByRole('button', { name: 'Load more history' }));
    await waitFor(() =>
      expect(within(screen.getByRole('table', { name: /Every change/ })).getAllByRole('row')).toHaveLength(26),
    );
    expect(api.callsTo('GET', HISTORY).map((call) => call.path)).toEqual([
      `${HISTORY}?limit=20`,
      `${HISTORY}?limit=20&before=6`,
    ]);
    expect(screen.getByText('Showing 25 changes.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more history' })).toBeNull();
  });

  it('records a change made on the screen at the top of the history', async () => {
    fakeAdminApi({ clients: [serviceClient('billing-1')], events: [event(1, 'billing-1', 'added')] });
    renderAt('/service-clients');
    await findHistory();
    await userEvent.click(screen.getByRole('button', { name: 'Disable billing-1' }));
    await waitFor(() =>
      expect(within(screen.getByRole('table', { name: /Every change/ })).getAllByRole('row')[1]).toHaveTextContent(
        'billing-1DisabledAda Lovelace',
      ),
    );
  });

  it('says there is no history yet, and offers a retry when it cannot be loaded', async () => {
    const api = fakeAdminApi();
    api.refuseNext('GET', HISTORY, () => nestError(503, 'Service Unavailable'));
    renderAt('/service-clients');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("The history couldn't be loaded");
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No changes have been made to the registry yet.')).toBeInTheDocument();
  });

  it('reloads the newest page when the refetch after a change fails and the administrator tries again', async () => {
    const api = fakeAdminApi({ clients: [serviceClient('billing-1')], events: [event(1, 'billing-1', 'added')] });
    renderAt('/service-clients');
    await findHistory();
    api.refuseNext('GET', HISTORY, () => nestError(503, 'Service Unavailable'));
    await userEvent.click(screen.getByRole('button', { name: 'Disable billing-1' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("The history couldn't be loaded");
    const loads = api.callsTo('GET', HISTORY).length;
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(within(screen.getByRole('table', { name: /Every change/ })).getAllByRole('row')[1]).toHaveTextContent(
        'billing-1DisabledAda Lovelace',
      ),
    );
    expect(
      api
        .callsTo('GET', HISTORY)
        .slice(loads)
        .map((call) => call.path),
    ).toEqual([`${HISTORY}?limit=20`]);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
