import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeConsoleApi } from './test-support/fake-console-api';
import { renderAt } from './test-support/render';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('signed-out visitors are sent to the sign-in card (R1, KTD4)', () => {
  it('sends /service-clients to /login with returnTo=/service-clients (AE1)', async () => {
    const api = fakeConsoleApi({ signedIn: false });
    const { router } = renderAt('/service-clients');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toEqual({ returnTo: '/service-clients' });
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2Fservice-clients',
    );
    expect(api.calls.filter((call) => call.path.startsWith('/api/v1/'))).toEqual([]);
  });

  it("carries console-api's /?authError= redirect over to the card (AE2)", async () => {
    const { router } = renderAt('/?authError=access_denied');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toEqual({ authError: 'access_denied', returnTo: '/' });
    expect(await screen.findByRole('alert')).toHaveTextContent("Sign-in didn't complete");
  });

  it('sends / to /login with returnTo=/ when the session cannot be checked (500)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.resolve(new Response('Internal Server Error', { status: 500 }))),
    );
    const { router } = renderAt('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toEqual({ returnTo: '/' });
    expect(await screen.findByText(/Your session could not be checked/)).toBeInTheDocument();
  });

  it('sends an unknown path to /login', async () => {
    const { router } = renderAt('/does-not-exist');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toEqual({ returnTo: '/does-not-exist' });
  });
});

describe('signed-in pages (R9, R10, R15, KTD5)', () => {
  it.each([
    ['/', 'Dashboard'],
    ['/service-clients', 'Service accounts'],
    ['/settings', 'Settings'],
    ['/help', 'Get help'],
  ])('renders %s titled %s, with the title as the only h1', async (path, title) => {
    fakeConsoleApi();
    const { router } = renderAt(path);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(router.state.location.pathname).toBe(path);
  });

  it('renders the page in <main id="main-content">, with a skip link to it', async () => {
    fakeConsoleApi();
    renderAt('/settings');
    const main = await screen.findByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(within(main).getByText(/no settings/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main-content');
  });

  it('renders "Page not found" inside the shell for an unknown path, as the only h1', async () => {
    fakeConsoleApi();
    const { router } = renderAt('/does-not-exist');
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/does-not-exist');
  });
});
