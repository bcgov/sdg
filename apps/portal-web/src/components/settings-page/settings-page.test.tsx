import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsPage } from '.';
import type { Profile } from '../../profile/api';

const CHANGE_URL =
  'https://www2.gov.bc.ca/gov/content/governments/government-id/bc-services-card/your-card/change-personal-information';

const fullProfile: Profile = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phoneNumber: '+1 250 555 0100',
  birthdate: '1980-01-05',
  gender: 'female',
  address: ['12 St James Sq', 'Victoria BC', 'V8W 1A1'],
};

const emptyProfile: Profile = {
  name: null,
  email: null,
  phoneNumber: null,
  birthdate: null,
  gender: null,
  address: null,
};

/** Answers GET /api/v1/portal/profile with `respond`, and counts the requests. */
function stubProfile(respond: () => Promise<Response>): () => number {
  let requests = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url !== '/api/v1/portal/profile') return Promise.reject(new Error(`unexpected request ${url}`));
      requests += 1;
      return respond();
    }),
  );
  return () => requests;
}

function renderPage(): QueryClient {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>,
  );
  return queryClient;
}

/** The value cell (first dd) of the row labelled `label` within `section`. */
function valueOf(section: HTMLElement, label: string): HTMLElement {
  const term = within(section).getByText(label, { selector: 'dt' });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`no value for ${label}`);
  return value;
}

describe('SettingsPage', () => {
  it('shows the resident’s profile and contact details', async () => {
    stubProfile(() => Promise.resolve(Response.json(fullProfile)));
    renderPage();
    const profile = screen.getByRole('region', { name: 'Profile' });
    await within(profile).findByText('Ada Lovelace');

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Profile',
      'Communication',
    ]);
    expect(profile).toHaveTextContent('Review or change your personal information.');
    expect([...profile.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
      'Photograph',
      'Full Name',
      'Date of Birth',
      'Address',
    ]);
    expect(
      within(valueOf(profile, 'Photograph')).getByRole('img', { name: 'Photograph not available' }),
    ).toBeInTheDocument();
    expect(valueOf(profile, 'Date of Birth')).toHaveTextContent('January 5, 1980');
    expect(within(valueOf(profile, 'Address')).getByText('12 St James Sq')).toBeInTheDocument();
    expect(within(valueOf(profile, 'Address')).getByText('V8W 1A1')).toBeInTheDocument();

    const communication = screen.getByRole('region', { name: 'Communication' });
    expect(communication).toHaveTextContent('Review or change your contact information');
    expect([...communication.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual(['Email', 'Phone Number']);
    expect(valueOf(communication, 'Email')).toHaveTextContent('ada@example.com');
    expect(valueOf(communication, 'Phone Number')).toHaveTextContent('+1 250 555 0100');
    expect(within(communication).queryByRole('link')).toBeNull();
  });

  it('links only the address to its BC Services Card page, in a new tab', async () => {
    stubProfile(() => Promise.resolve(Response.json(fullProfile)));
    renderPage();
    const profile = screen.getByRole('region', { name: 'Profile' });
    await within(profile).findByText('Ada Lovelace');

    const [link, ...others] = within(profile).getAllByRole('link');
    expect(others).toEqual([]);
    expect(link).toHaveAccessibleName('Change my address (opens in a new tab)');
    expect(link).toHaveTextContent('Change my address');
    expect(link).toHaveAttribute('href', `${CHANGE_URL}#address`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(valueOf(profile, 'Full Name').nextElementSibling).toBeNull();
    expect(valueOf(profile, 'Date of Birth').nextElementSibling).toBeNull();
  });

  it('borders both detail lists', async () => {
    stubProfile(() => Promise.resolve(Response.json(fullProfile)));
    renderPage();
    await screen.findByText('Ada Lovelace');

    const lists = screen.getAllByRole('region').map((region) => region.querySelector('dl'));
    expect(lists).toHaveLength(2);
    for (const list of lists) expect(list?.className).toMatch(/bordered/);
  });

  it('shows Not provided for missing values and keeps the change link (AE3, AE4)', async () => {
    stubProfile(() => Promise.resolve(Response.json({ ...emptyProfile, name: 'Ada Lovelace' })));
    renderPage();
    const profile = screen.getByRole('region', { name: 'Profile' });
    await within(profile).findByText('Ada Lovelace');
    const communication = screen.getByRole('region', { name: 'Communication' });

    expect(valueOf(profile, 'Date of Birth')).toHaveTextContent('Not provided');
    expect(valueOf(profile, 'Address')).toHaveTextContent('Not provided');
    expect(within(profile).getByRole('link', { name: /^Change my address/ })).toBeInTheDocument();
    expect(valueOf(communication, 'Email')).toHaveTextContent('Not provided');
    expect(valueOf(communication, 'Phone Number')).toHaveTextContent('Not provided');
  });

  it('contains a failed load to the profile sections, after one request (AE5)', async () => {
    const requests = stubProfile(() => Promise.resolve(Response.json({ statusCode: 503 }, { status: 503 })));
    renderPage();
    const profile = screen.getByRole('region', { name: 'Profile' });
    const communication = screen.getByRole('region', { name: 'Communication' });

    expect(await within(profile).findByText('We couldn’t load your details')).toBeInTheDocument();
    expect(within(communication).getByText('We couldn’t load your details')).toBeInTheDocument();
    expect(profile.querySelector('dl')).toBeNull();
    expect(requests()).toBe(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });

  it.each([
    ['a non-string name', () => Response.json({ ...fullProfile, name: 5 })],
    ['a non-string address line', () => Response.json({ ...fullProfile, address: [1] })],
    ['a body that is not JSON', () => new Response('<html>gateway</html>', { status: 200 })],
  ])('treats a profile answer with %s as a failed load', async (_case, answer) => {
    stubProfile(() => Promise.resolve(answer()));
    renderPage();
    const profile = screen.getByRole('region', { name: 'Profile' });
    expect(await within(profile).findByText('We couldn’t load your details')).toBeInTheDocument();
  });

  it('keeps showing loaded details when a later refetch fails', async () => {
    let fail = false;
    stubProfile(() =>
      Promise.resolve(fail ? Response.json({ statusCode: 503 }, { status: 503 }) : Response.json(fullProfile)),
    );
    const queryClient = renderPage();
    const profile = screen.getByRole('region', { name: 'Profile' });
    await within(profile).findByText('Ada Lovelace');

    fail = true;
    await act(() => queryClient.refetchQueries());
    expect(queryClient.getQueryState(['portal', 'profile'])?.status).toBe('error');
    // React Query notifies observers on a later tick; let the page re-render before asserting.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(within(profile).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByText('We couldn’t load your details')).toBeNull();
  });

  it('shows a loading indicator, and never Not provided, while the profile loads (R20)', () => {
    stubProfile(() => new Promise<Response>(() => undefined));
    renderPage();
    const profile = screen.getByRole('region', { name: 'Profile' });
    const communication = screen.getByRole('region', { name: 'Communication' });

    expect(within(profile).getByRole('progressbar', { name: 'Loading your details' })).toBeInTheDocument();
    expect(within(communication).getByRole('progressbar', { name: 'Loading your details' })).toBeInTheDocument();
    expect(profile).toHaveTextContent('Review or change your personal information.');
    expect(screen.queryByText('Not provided')).toBeNull();
  });
});
