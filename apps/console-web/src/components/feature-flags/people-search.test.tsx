import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { nestError } from '../../test-support/fake-console-api';
import { fakeFeatureFlagsApi, flag, person } from '../../test-support/fake-feature-flags-api';
import { renderAt } from '../../test-support/render';
import { tabTo } from '../../test-support/shell';
import { PeopleSearch, SEARCH_DEBOUNCE_MS } from './people-search';

const SEARCH = '/api/v1/console/people/search';

const searchbox = async () =>
  within(await screen.findByRole('dialog', { name: 'Add or change an override' })).getByRole('searchbox', {
    name: /Find a person/,
  });

/** The polite live region (role status) that announces the result count. */
const announcer = () => screen.getByRole('status', { name: 'Search results' });

const settle = () => new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 100));

/** The flag's page with the override dialog open on its people search. */
async function renderSearch(people = [person('Grace Hopper', 'resident'), person('Grant Wood', 'resident')]) {
  const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')], people });
  renderAt('/feature-flags/hello_world?tab=overrides');
  await userEvent.click(await screen.findByRole('button', { name: 'Add or change an override' }, { timeout: 15000 }));
  return api;
}

const noop = () => {};

describe('the people search (R18, KTD9)', () => {
  it('sends nothing for one character and shows the hint', async () => {
    const api = await renderSearch();
    expect(await screen.findByText('Enter at least 2 characters to search.')).toBeInTheDocument();
    await userEvent.type(await searchbox(), ' g ');
    await settle();
    expect(api.callsTo('POST', SEARCH)).toEqual([]);
    expect(screen.getByText('Enter at least 2 characters to search.')).toBeInTheDocument();
  });

  it('waits for typing to pause, then sends the trimmed query once', async () => {
    const api = await renderSearch();
    await userEvent.type(await searchbox(), ' gra ');
    expect(await screen.findByRole('button', { name: /^Grace Hopper/ })).toBeInTheDocument();
    expect(api.callsTo('POST', SEARCH).map((call) => call.body)).toEqual([{ query: 'gra', audience: 'portal' }]);
  });

  it('reaches the results with Tab, chooses one with Enter, and announces the count', async () => {
    const user = userEvent.setup();
    await renderSearch();
    await user.type(await searchbox(), 'gr');
    const grace = await screen.findByRole('button', { name: /^Grace Hopper/ });
    expect(screen.getByRole('button', { name: /^Grant Wood/ })).toBeInTheDocument();
    await waitFor(() => expect(announcer()).toHaveTextContent('2 people found.'));

    await tabTo(user, grace);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'Turn on for Grace Hopper' })).toBeInTheDocument();
  });

  it('says when no one matches', async () => {
    await renderSearch();
    await userEvent.type(await searchbox(), 'zz');
    expect(await screen.findByText('No one matches that search.')).toBeInTheDocument();
    await waitFor(() => expect(announcer()).toHaveTextContent('No people found.'));
  });

  it('asks for a narrower search when more than 20 match', async () => {
    await renderSearch(
      Array.from({ length: 25 }, (_, i) => person(`Person ${String(i).padStart(2, '0')}`, 'resident')),
    );
    await userEvent.type(await searchbox(), 'person');
    expect(
      await screen.findByText('Showing the first 20 matches. Refine your search to find someone else.'),
    ).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'People found' })).getAllByRole('button')).toHaveLength(20);
  });

  it("suggests part of the name when the edge's WAF refuses the search (bare 403)", async () => {
    const api = await renderSearch();
    api.refuseNext('POST', SEARCH, () => new Response('Forbidden', { status: 403 }));
    await userEvent.type(await searchbox(), "o'brien");
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The search was blocked');
    expect(alert).toHaveTextContent('Search for part of the name instead.');
    expect(screen.queryByRole('heading', { name: /not authorized/ })).toBeNull();
  });

  it('shows the generic failure with a retry for a 503', async () => {
    const api = await renderSearch();
    api.refuseNext('POST', SEARCH, () => nestError(503, 'Service Unavailable'));
    await userEvent.type(await searchbox(), 'gra');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("The search couldn't be completed");
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /^Grace Hopper/ })).toBeInTheDocument();
  });

  it('shows "No email" when a matching person has email null (line 55)', async () => {
    await renderSearch([person('Grace Hopper', 'resident', { email: null })]);
    await userEvent.type(await searchbox(), 'gra');
    const button = await screen.findByRole('button', { name: /^Grace Hopper/ });
    expect(button).toHaveTextContent('No email');
  });

  it.each([
    ['401', () => nestError(401, 'Unauthorized')],
    ["core-api's 403", () => nestError(403, 'Forbidden', 'Forbidden')],
  ])('renders no inline alert when search fails with %s (line 32)', async (_label, respond) => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')], people: [] });
    api.refuseNext('POST', SEARCH, respond);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <PeopleSearch audience="portal" onChoose={noop} />
      </QueryClientProvider>,
    );
    await userEvent.type(screen.getByRole('searchbox', { name: /Find a person/ }), 'gra');
    await waitFor(() => expect(api.callsTo('POST', SEARCH)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('Searching…')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
