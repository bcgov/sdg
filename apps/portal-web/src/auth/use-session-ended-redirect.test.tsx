import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/http';
import { App } from '../app';
import { createAppRouter } from '../router';
import { currentUserQueryKey } from './use-current-user';

vi.mock('../components/devtools', () => ({ Devtools: () => null }));

const user = { id: 'p-1', name: 'Ada Lovelace', email: 'ada@example.com' };
const fullProfile = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phoneNumber: null,
  birthdate: null,
  gender: null,
  address: null,
};

const status = (code: number): Response => Response.json({ statusCode: code }, { status: code });

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** portal-api answers by path; `answers` can change during a test. */
function stubApi(answers: Record<string, () => Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input) => Promise.resolve(answers[urlOf(input)]?.() ?? status(404))),
  );
}

function renderAt(path: string) {
  const queryClient = new QueryClient();
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [path] }) });
  // jsdom can't leave the page: record full-page navigations (the login redirect) instead of performing them.
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
  return { queryClient, router, documentNavigations };
}

const sessionEnded = (queryClient: QueryClient, key: string) =>
  queryClient
    .fetchQuery({ queryKey: [key], queryFn: () => Promise.reject(new ApiError('session-ended', 401)), retry: false })
    .catch(() => undefined);

describe('useSessionEndedRedirect', () => {
  it('sends a resident whose session ended on Settings to sign in, returning to Settings, with no error shown', async () => {
    stubApi({ '/api/auth/me': () => Response.json(user), '/api/v1/portal/profile': () => status(401) });
    const { queryClient, documentNavigations } = renderAt('/settings?tab=profile');

    await waitFor(() => expect(documentNavigations).toEqual(['/api/auth/login?returnTo=%2Fsettings%3Ftab%3Dprofile']));
    expect(queryClient.getQueryData(currentUserQueryKey)).toBeNull();
    expect(screen.queryByText('We couldn’t load your details')).not.toBeInTheDocument();
  });

  it('keeps the resident on Settings with its error state when portal-api is unavailable', async () => {
    stubApi({ '/api/auth/me': () => Response.json(user), '/api/v1/portal/profile': () => status(503) });
    const { queryClient, documentNavigations } = renderAt('/settings');

    const profile = await screen.findByRole('region', { name: 'Profile' });
    expect(await within(profile).findByText('We couldn’t load your details')).toBeInTheDocument();
    expect(documentNavigations).toEqual([]);
    expect(queryClient.getQueryData(currentUserQueryKey)).toEqual(user);
  });

  it('redirects once when several calls find the session ended', async () => {
    stubApi({ '/api/auth/me': () => Response.json(user), '/api/v1/portal/profile': () => Response.json(fullProfile) });
    const { queryClient, documentNavigations } = renderAt('/settings');
    await screen.findAllByText('Ada Lovelace');

    await act(() => Promise.all([sessionEnded(queryClient, 'a'), sessionEnded(queryClient, 'b')]));
    expect(documentNavigations).toEqual(['/api/auth/login?returnTo=%2Fsettings']);
  });

  it('sends the resident to sign in when a /me refetch on a signed-in page answers signed out', async () => {
    const answers = {
      '/api/auth/me': () => Response.json(user),
      '/api/v1/portal/profile': () => Response.json(fullProfile),
    };
    stubApi(answers);
    const { queryClient, documentNavigations } = renderAt('/settings');
    await screen.findAllByText('Ada Lovelace');

    answers['/api/auth/me'] = () => status(401);
    await act(() => queryClient.refetchQueries({ queryKey: currentUserQueryKey }));
    expect(documentNavigations).toEqual(['/api/auth/login?returnTo=%2Fsettings']);
  });

  it('only signs the header out on a public page', async () => {
    stubApi({ '/api/auth/me': () => Response.json(user) });
    const { queryClient, router, documentNavigations } = renderAt('/');
    await waitFor(() => expect(queryClient.getQueryData(currentUserQueryKey)).toEqual(user));

    await act(() => sessionEnded(queryClient, 'a'));
    expect(queryClient.getQueryData(currentUserQueryKey)).toBeNull();
    expect(documentNavigations).toEqual([]);
    expect(router.state.location.pathname).toBe('/');
  });

  it('leaves Log Out its own redirect: clearing the user by hand is not a session ending', async () => {
    stubApi({ '/api/auth/me': () => Response.json(user), '/api/v1/portal/profile': () => Response.json(fullProfile) });
    const { queryClient, documentNavigations } = renderAt('/settings');
    await screen.findAllByText('Ada Lovelace');

    act(() => {
      queryClient.setQueryData(currentUserQueryKey, null);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(documentNavigations).toEqual([]);
  });
});
