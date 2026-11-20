import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../../app';
import { createAppRouter } from '../../router';

vi.mock('../../components/devtools', () => ({ Devtools: () => null }));

const user = { id: 'p-1', name: 'Ada Lovelace', email: 'ada@example.com' };

const unauthorized = (): Response => Response.json({ statusCode: 401 }, { status: 401 });

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** portal-api's GET /api/auth/me answers `me`; every other request answers 401 like test-setup's default. */
function stubCurrentUser(me: () => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input) => Promise.resolve(urlOf(input) === '/api/auth/me' ? me() : unauthorized())),
  );
}

function renderAt(path: string) {
  const queryClient = new QueryClient();
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [path] }) });
  // jsdom can't leave the page: record full-page navigations (the guard's login redirect) instead of performing them.
  const documentNavigations: string[] = [];
  const original = router.navigate.bind(router);
  vi.spyOn(router, 'navigate').mockImplementation(async (options) => {
    if (options.reloadDocument && options.href) {
      documentNavigations.push(options.href);
      return;
    }
    return original(options);
  });
  render(<App queryClient={queryClient} router={router} />);
  return { router, documentNavigations };
}

describe('account settings route', () => {
  it('renders Account Settings with the Profile, Communication and Data & Privacy sections when signed in', async () => {
    stubCurrentUser(() => Response.json(user));
    renderAt('/account-settings');
    const main = await screen.findByRole('main');

    expect(await within(main).findByRole('heading', { level: 1 })).toHaveTextContent('Account Settings');
    expect(within(main).getByRole('separator')).toBeInTheDocument();
    expect(
      within(main)
        .getAllByRole('heading', { level: 2 })
        .map((h) => h.textContent),
    ).toEqual(['Profile', 'Communication', 'Data & Privacy']);
    expect(within(main).getByRole('region', { name: 'Profile' })).toHaveTextContent(
      'Habitant sit ut scelerisque a metus BC Services Card.',
    );
  });

  it('sends a signed-out visitor to the BFF login, returning to the page they asked for', async () => {
    stubCurrentUser(unauthorized);
    const { documentNavigations } = renderAt('/account-settings?tab=profile');

    await waitFor(() =>
      expect(documentNavigations).toEqual(['/api/auth/login?returnTo=%2Faccount-settings%3Ftab%3Dprofile']),
    );
    expect(screen.queryByRole('heading', { name: 'Account Settings' })).not.toBeInTheDocument();
  });

  it('sends the visitor to the BFF login when portal-api fails, and logs the failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubCurrentUser(() => new Response('Bad gateway', { status: 502 }));
    const { documentNavigations } = renderAt('/account-settings');

    await waitFor(() => expect(documentNavigations).toEqual(['/api/auth/login?returnTo=%2Faccount-settings']));
    expect(consoleError).toHaveBeenCalledWith('portal-web: could not load the current user', expect.any(Error));
    expect(screen.queryByRole('heading', { name: 'Account Settings' })).not.toBeInTheDocument();
  });

  it("routes the header's sdg-settings client-side for a signed-in user", async () => {
    stubCurrentUser(() => Response.json(user));
    const { router } = renderAt('/');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Access services online');
    const settings = new CustomEvent('sdg-settings', { bubbles: true, composed: true, cancelable: true });
    document.querySelector('sdg-header')!.dispatchEvent(settings);

    expect(settings.defaultPrevented).toBe(true);
    expect(await screen.findByRole('heading', { level: 1, name: 'Account Settings' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/account-settings');
  });
});
