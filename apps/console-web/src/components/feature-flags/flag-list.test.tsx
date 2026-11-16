import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { fakeFeatureFlagsApi, flag, overrideFor, person } from '../../test-support/fake-feature-flags-api';
import { renderAt } from '../../test-support/render';

const LIST = '/api/v1/console/feature-flags';

/** The table once a load has settled: no longer busy. */
async function grid() {
  const table = await screen.findByRole('grid', { name: 'Feature flags' });
  await waitFor(() => expect(table.closest('[aria-busy="true"]')).toBeNull());
  return table;
}
const bodyRows = async () =>
  within(await grid())
    .getAllByRole('row')
    .slice(1);
const keys = async () => (await bodyRows()).map((row) => within(row).getByRole('rowheader').textContent);
const inGrid = async (text: string | RegExp) => within(await grid()).findByText(text);
const pager = () => within(screen.getByRole('navigation', { name: 'Pagination' }));
const searchBox = () => screen.getByRole('searchbox', { name: 'Search' });
type Api = ReturnType<typeof fakeFeatureFlagsApi>;
const listCalls = (api: Api) => api.callsTo('GET', LIST).map((call) => call.path.slice(LIST.length));

const forcedOn = (name: string) => overrideFor(person(name, 'resident'), true);

/** `count` flags named `<prefix>_01`, `<prefix>_02`, …, all off unless `fields` says otherwise. */
const numbered = (prefix: string, count: number, fields: Parameters<typeof flag>[1] = {}) =>
  Array.from({ length: count }, (_, index) => flag(`${prefix}_${String(index + 1).padStart(2, '0')}`, fields));

describe('the feature flag list on the DataTable (R15–R18)', () => {
  it('Should show each flag with its audience, switch, rollout and override counts, each row a link', async () => {
    const [ada, bob, cy] = [person('Ada', 'resident'), person('Bob', 'resident'), person('Cy', 'console-user')];
    const api = fakeFeatureFlagsApi({
      flags: [
        flag('new_search', { enabled: false, rolloutPct: 0, audience: 'console', overrides: [overrideFor(cy, true)] }),
        flag('hello_world', {
          enabled: true,
          rolloutPct: 50,
          overrides: [overrideFor(ada, true), overrideFor(bob, false)],
        }),
      ],
    });
    renderAt('/feature-flags');
    const rows = await bodyRows();
    expect(rows.map((row) => row.textContent)).toEqual([
      'hello_worldPortalOn50%1 on, 1 off',
      'new_searchConsoleOff0%1 on, 0 off',
    ]);
    expect(rows[0]).toHaveAttribute('data-href', '/feature-flags/hello_world');
    // Two flags fit on one page: no count, rows per page or pager.
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
    expect(listCalls(api)).toEqual(['?limit=20&offset=0&sort=key&order=asc']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Should show the first page of matches with q=check and no page, and Back returns to page 3 (AE1)', async () => {
    const api = fakeFeatureFlagsApi({ flags: [...numbered('flag', 60), ...numbered('check', 3)] });
    const { router } = renderAt('/feature-flags?page=3');
    expect((await keys())[0]).toBe('flag_38');
    await userEvent.type(searchBox(), 'check');

    await waitFor(() => expect(router.state.location.search).toEqual({ q: 'check' }));
    await waitFor(async () => expect(await keys()).toEqual(['check_01', 'check_02', 'check_03']));
    expect(listCalls(api).at(-1)).toBe('?limit=20&offset=0&q=check&sort=key&order=asc');
    expect(router.state.location.href).toBe('/feature-flags?q=check');

    router.history.back();
    await waitFor(() => expect(router.state.location.search).toEqual({ page: '3' }));
    await waitFor(async () => expect((await keys())[0]).toBe('flag_38'));
    expect(searchBox()).toHaveValue('');

    // The URL shows the same view in another tab.
    cleanup();
    renderAt('/feature-flags?q=check');
    expect(await keys()).toEqual(['check_01', 'check_02', 'check_03']);
  });

  it('Should request audience=portal for Audience: Portal and show the portal and both flags (R15)', async () => {
    const api = fakeFeatureFlagsApi({
      flags: [
        flag('portal_one', { audience: 'portal' }),
        flag('console_one', { audience: 'console' }),
        flag('both_one', { audience: 'both' }),
      ],
    });
    const { router } = renderAt('/feature-flags');
    expect(await keys()).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: /Audience/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Portal' }));

    await waitFor(async () => expect(await keys()).toEqual(['both_one', 'portal_one']));
    expect(router.state.location.search).toEqual({ audience: 'portal' });
    expect(listCalls(api).at(-1)).toBe('?limit=20&offset=0&audience=portal&sort=key&order=asc');
  });

  it('Should sort by the most "on" overrides first when Overrides is activated (AE3)', async () => {
    const api = fakeFeatureFlagsApi({
      flags: [
        flag('alpha'),
        flag('bravo', { overrides: [forcedOn('Ada'), forcedOn('Bob')] }),
        flag('charlie', { overrides: [forcedOn('Cy')] }),
      ],
    });
    renderAt('/feature-flags');
    expect(await keys()).toEqual(['alpha', 'bravo', 'charlie']);
    const header = screen.getByRole('columnheader', { name: /Overrides/ });
    await userEvent.click(header);

    await waitFor(async () => expect(await keys()).toEqual(['bravo', 'charlie', 'alpha']));
    expect(listCalls(api).at(-1)).toBe('?limit=20&offset=0&sort=overridesOn&order=desc');
    expect(screen.getByRole('columnheader', { name: /Overrides/ })).toHaveAttribute('aria-sort', 'descending');
  });

  it('Should say no flags match a search, and clearing it restores the unfiltered first page (AE4)', async () => {
    const api = fakeFeatureFlagsApi({ flags: numbered('flag', 25) });
    const { router } = renderAt('/feature-flags?q=nothing&page=2');
    expect(await inGrid('No feature flags match the search or filters.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));

    await waitFor(() => expect(router.state.location.search).toEqual({}));
    await waitFor(async () => expect(await keys()).toHaveLength(20));
    expect(listCalls(api).at(-1)).toBe('?limit=20&offset=0&sort=key&order=asc');
  });

  it('Should open a flag with Enter on its row, carrying the list params (AE6, R18)', async () => {
    fakeFeatureFlagsApi({ flags: numbered('flag', 25) });
    const { router } = renderAt('/feature-flags?enabled=false&page=2');
    const [first] = await bodyRows();
    expect(first).toHaveAttribute('data-href', '/feature-flags/flag_21?enabled=false&page=2');
    first!.focus();
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByRole('heading', { level: 2, name: 'flag_21' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/feature-flags/flag_21');
    expect(router.state.location.search).toEqual({ enabled: 'false', page: '2' });
  });

  it('Should keep ?page=3&enabled=false&q=2024 as plain strings through the router (KTD8)', async () => {
    const api = fakeFeatureFlagsApi({ flags: numbered('flag_2024', 50) });
    const { router } = renderAt('/feature-flags?page=3&enabled=false&q=2024');
    expect(await keys()).toHaveLength(10);
    expect(router.state.location.search).toEqual({ page: '3', enabled: 'false', q: '2024' });
    expect(router.state.location.href).toBe('/feature-flags?page=3&enabled=false&q=2024');
    expect(listCalls(api)).toEqual(['?limit=20&offset=40&q=2024&enabled=false&sort=key&order=asc']);
  });

  it('Should return to page 2 of the enabled=false view with the confirmation after a delete (R18, KTD10)', async () => {
    const api = fakeFeatureFlagsApi({ flags: numbered('flag', 25) });
    const { router } = renderAt('/feature-flags?enabled=false&page=2');
    await userEvent.click((await bodyRows())[0]!);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete flag_21' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete flag_21?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/feature-flags'));
    expect(router.state.location.search).toEqual({ enabled: 'false', page: '2', deleted: 'flag_21' });
    expect(screen.getByRole('status', { name: 'Feature flag updates' })).toHaveTextContent('Deleted flag_21.');
    expect(screen.queryByRole('rowheader', { name: 'flag_21' })).toBeNull();
    await waitFor(async () => expect(await keys()).toEqual(['flag_22', 'flag_23', 'flag_24', 'flag_25']));
    expect(api.find('flag_21')).toBeUndefined();
  });

  it('Should replace ?pageSize=7 with the default, and a clamped page with the page the server used (R14)', async () => {
    fakeFeatureFlagsApi({ flags: numbered('flag', 25) });
    const first = renderAt('/feature-flags?pageSize=7');
    await waitFor(() => expect(first.router.state.location.search).toEqual({}));
    expect(first.router.history.length).toBe(1);

    cleanup();
    const second = renderAt('/feature-flags?page=9');
    await waitFor(() => expect(second.router.state.location.search).toEqual({ page: '2' }));
    expect(second.router.history.length).toBe(1);
    expect(await keys()).toHaveLength(5);
    expect(pager().getByText('Showing 21–25 of 25')).toBeInTheDocument();
  });

  it('Should show the blocked wording with no retry when the edge refuses a search with a bare 403 (KTD12)', async () => {
    const api = fakeFeatureFlagsApi({ flags: numbered('flag', 3) });
    api.refuseNext('GET', LIST, () => new Response('Forbidden', { status: 403 }));
    renderAt("/feature-flags?q=o'brien");
    expect(await inGrid(/The search was blocked/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(api.callsTo('GET', LIST)).toHaveLength(1);
  });

  it('Should offer a retry when the list cannot be loaded (503)', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')] });
    api.refuseNext('GET', LIST, () => new Response(null, { status: 503 }));
    renderAt('/feature-flags');
    expect(await inGrid("The feature flags couldn't be loaded. Try again in a moment.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await keys()).toEqual(['hello_world']);
  });

  it('Should say none exist yet in a fresh environment', async () => {
    fakeFeatureFlagsApi();
    renderAt('/feature-flags');
    expect(await inGrid('No feature flags exist yet.')).toBeInTheDocument();
  });

  it('Should refresh the current page after creating a flag from the dialog, which starts at 0%', async () => {
    const api = fakeFeatureFlagsApi({ flags: numbered('flag', 25) });
    renderAt('/feature-flags?page=2');
    expect(await keys()).toHaveLength(5);
    await userEvent.click(screen.getByRole('button', { name: 'Create feature flag' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Create a feature flag' }));
    expect(dialog.getByRole('textbox', { name: /Rollout percentage/ })).toHaveValue('0');
    await userEvent.type(dialog.getByRole('textbox', { name: /Key/ }), 'zulu');
    await userEvent.click(dialog.getByRole('button', { name: 'Create feature flag' }));

    await waitFor(async () => expect((await keys()).at(-1)).toBe('zulu'));
    expect(listCalls(api).filter((path) => path.includes('offset=20'))).toHaveLength(2);
  });
});
