import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { fakeFeatureFlagsApi, flag, flagEvent } from '../../test-support/fake-feature-flags-api';
import { renderAt } from '../../test-support/render';

const HISTORY = '/api/v1/console/feature-flag-history';
const GRACE = { principalId: '00000000-0000-4000-8000-0000000000aa', name: 'Grace Hopper' };

/** The history table once a load has settled. */
async function historyGrid(key = 'hello_world') {
  const table = await screen.findByRole('grid', { name: `Changes to ${key}, newest first` });
  await waitFor(() => expect(table.closest('[aria-busy="true"]')).toBeNull());
  return table;
}

const bodyRows = async (key?: string) =>
  within(await historyGrid(key))
    .getAllByRole('row')
    .slice(1);
/** Each row's Admin, Action and Change cells. */
const rowTexts = async (key?: string) =>
  (await bodyRows(key)).map((row) => [...row.querySelectorAll('td')].slice(1).map((cell) => cell.textContent));
/** The event each row shows, by the rollout it changed to (the fake's events change it to their own id). */
const shownIds = async () => (await rowTexts()).map((cells) => Number(/→ (\d+)%/.exec(cells.at(-1) ?? '')?.[1]));
const button = (name: string) => screen.getByRole('button', { name });
const historyCalls = (api: ReturnType<typeof fakeFeatureFlagsApi>) =>
  api.callsTo('GET', HISTORY).map((call) => call.path.slice(HISTORY.length));

/** `count` updates to hello_world, event `n` changing the rollout to n%. */
const updates = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    flagEvent(index + 1, 'hello_world', 'updated', { rollout_pct: { from: index, to: index + 1 } }),
  );

describe('a flag’s history as a cursor DataTable (R19, R20)', () => {
  it('Should show When, Admin, Action and Change, newest first', async () => {
    const api = fakeFeatureFlagsApi({
      flags: [flag('hello_world')],
      events: [
        flagEvent(1, 'hello_world', 'created', {
          enabled: { from: null, to: false },
          rollout_pct: { from: null, to: 0 },
        }),
        flagEvent(2, 'hello_world', 'override_set', { enabled: { from: null, to: true } }, GRACE),
        flagEvent(3, 'other_flag', 'created', { enabled: { from: null, to: true } }),
        flagEvent(4, 'hello_world', 'updated', {
          rollout_pct: { from: 0, to: 80 },
          audience: { from: 'portal', to: 'both' },
        }),
      ],
    });
    renderAt('/feature-flags/hello_world?tab=history');
    const grid = await historyGrid();
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['When', 'Admin', 'Action', 'Change']);
    expect(await rowTexts()).toEqual([
      ['Ada Lovelace', 'Updated', 'Rollout: 0% → 80%; Audience: Portal → Portal and console'],
      ['Ada Lovelace', 'Override set for Grace Hopper', 'Override: on'],
      ['Ada Lovelace', 'Created', 'Switch: off; Rollout: 0%'],
    ]);
    const [newest] = await bodyRows();
    expect(within(newest!).getByRole('rowheader').querySelector('time')).toHaveAttribute(
      'dateTime',
      '2026-11-10T17:04:00.000Z',
    );
    expect(historyCalls(api)).toEqual(['?key=hello_world&limit=20']);
  });

  it('Should go Older twice, survive a reload, and go Newer twice back to the newest (AE5)', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')], events: updates(75) });
    const first = renderAt('/feature-flags/hello_world?tab=history');
    expect((await shownIds())[0]).toBe(75);
    await userEvent.click(button('Older'));
    await waitFor(async () => expect((await shownIds())[0]).toBe(55));
    await userEvent.click(button('Older'));
    await waitFor(async () => expect((await shownIds())[0]).toBe(35));
    expect(first.router.state.location.href).toBe('/feature-flags/hello_world?tab=history&h.before=36');

    cleanup();
    const { router } = renderAt('/feature-flags/hello_world?tab=history&h.before=36');
    expect(await shownIds()).toEqual(Array.from({ length: 20 }, (_, index) => 35 - index));
    await userEvent.click(button('Newer'));
    await waitFor(async () => expect((await shownIds())[0]).toBe(55));
    await userEvent.click(button('Newer'));
    await waitFor(async () => expect((await shownIds())[0]).toBe(75));

    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'history' }));
    expect(button('Newer')).toBeDisabled();
    expect(button('Newest')).toBeDisabled();
    expect(button('Older')).toBeEnabled();
    // The corrected URL then reads the newest page as itself.
    expect(historyCalls(api).slice(-4)).toEqual([
      '?key=hello_world&limit=20&before=36',
      '?key=hello_world&limit=20&after=35',
      '?key=hello_world&limit=20&after=55',
      '?key=hello_world&limit=20',
    ]);
  });

  it('Should show the full newest page for an h.after past the newest, dropping it with replace (KTD3)', async () => {
    fakeFeatureFlagsApi({ flags: [flag('hello_world')], events: updates(75) });
    const { router } = renderAt('/feature-flags/hello_world?tab=history&h.after=70');
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'history' }));
    expect(await shownIds()).toHaveLength(20);
    expect((await shownIds())[0]).toBe(75);
    expect(router.history.length).toBe(1);
  });

  it('Should keep the carried list params beside h.before, and deleting returns to that list view (KTD10)', async () => {
    const others = Array.from({ length: 25 }, (_, index) => flag(`flag_${String(index + 1).padStart(2, '0')}`));
    fakeFeatureFlagsApi({ flags: [flag('hello_world'), ...others], events: updates(50) });
    const { router } = renderAt('/feature-flags/hello_world?enabled=false&page=2&tab=history');
    await userEvent.click(await screen.findByRole('button', { name: 'Older' }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ enabled: 'false', page: '2', tab: 'history', 'h.before': '31' }),
    );
    expect(screen.getByRole('link', { name: 'All feature flags' })).toHaveAttribute(
      'href',
      '/feature-flags?enabled=false&page=2',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete hello_world' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete hello_world?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/feature-flags'));
    expect(router.state.location.search).toEqual({ enabled: 'false', page: '2', deleted: 'hello_world' });
  });

  it('Should show a deleted key’s history table and no edit, delete or override controls (R19, AE7)', async () => {
    const api = fakeFeatureFlagsApi({
      flags: [flag('other_flag')],
      events: [
        flagEvent(1, 'old_flag', 'created', { enabled: { from: null, to: false } }),
        flagEvent(2, 'other_flag', 'created', { enabled: { from: null, to: false } }),
        flagEvent(3, 'old_flag', 'deleted', { overridesRemoved: 2 }),
      ],
    });
    renderAt('/feature-flags/old_flag');
    expect(await screen.findByText('This flag was deleted. Its history is kept.')).toBeInTheDocument();
    expect(await rowTexts('old_flag')).toEqual([
      ['Ada Lovelace', 'Deleted', '2 overrides removed'],
      ['Ada Lovelace', 'Created', 'Switch: off'],
    ]);
    expect(historyCalls(api)).toContain('?key=old_flag&limit=20');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: /Save|Delete|Edit/ })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('Should add a change made on the page to the top of the history', async () => {
    fakeFeatureFlagsApi({ flags: [flag('hello_world')] });
    renderAt('/feature-flags/hello_world');
    const switchCard = within(await screen.findByRole('region', { name: 'Switch' }));
    await userEvent.click(switchCard.getByRole('switch', { name: 'On' }));
    await waitFor(() => expect(switchCard.getByRole('switch', { name: 'On' })).toBeChecked());
    await userEvent.click(screen.getByRole('tab', { name: 'History' }));
    await waitFor(async () => expect(await rowTexts()).toEqual([['Ada Lovelace', 'Updated', 'Switch: off → on']]));
  });
});
