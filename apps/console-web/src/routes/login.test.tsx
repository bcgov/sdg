import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeConsoleApi } from '../test-support/fake-console-api';
import { renderAt } from '../test-support/render';

afterEach(() => {
  vi.restoreAllMocks();
});

/** The sign-in card: the page's only landmark, titled by its h1. */
async function findCard() {
  const main = await screen.findByRole('main');
  expect(main).toHaveAttribute('id', 'main-content');
  return within(main);
}

describe('sign-in card (R1)', () => {
  it('shows the emblem, "SDG Console" and a Sign in link back to the Dashboard when signed out', async () => {
    renderAt('/login');
    const card = await findCard();
    expect(await card.findByRole('heading', { level: 1, name: 'SDG Console' })).toBeInTheDocument();
    expect(card.getByText('Sign in with your IDIR to manage SDG.')).toBeInTheDocument();
    expect(card.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/api/auth/login?returnTo=%2F');
    expect(document.querySelector('img[src="/favicon.svg"]')).toHaveAttribute('alt', '');
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('contentinfo')).toBeNull();
  });

  it('drops a returnTo that leaves the app, so Sign in returns to the Dashboard', async () => {
    renderAt('/login?returnTo=%2F%2Fevil.example');
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2F',
    );
  });

  it('says the session could not be checked and still offers Sign in when console-api fails (R4)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.resolve(new Response('Internal Server Error', { status: 500 }))),
    );
    renderAt('/login');
    const card = await findCard();
    expect(await card.findByText(/Your session could not be checked/)).toBeInTheDocument();
    expect(card.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/api/auth/login?returnTo=%2F');
    expect(consoleError).toHaveBeenCalledWith('console-web: could not load the current user', expect.any(Error));
  });

  it('sends a signed-in administrator on to the Dashboard (AE1, R5)', async () => {
    fakeConsoleApi();
    const { router } = renderAt('/login');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });

  it('sends a signed-in administrator to the returnTo page', async () => {
    fakeConsoleApi();
    const { router } = renderAt('/login?returnTo=%2Fsettings');
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
  });
});

describe('session ended (R2)', () => {
  it('shows the notice and signs in again back to where the administrator was', async () => {
    renderAt('/login?session=ended&returnTo=%2Fservice-clients');
    const card = await findCard();
    expect(await card.findByRole('alert')).toHaveTextContent('Your session ended');
    expect(card.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2Fservice-clients',
    );
    expect(card.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2Fservice-clients',
    );
  });

  it('clears the notice from the URL when dismissed, keeping where Sign in returns to', async () => {
    const { router } = renderAt('/login?session=ended&returnTo=%2Fservice-clients');
    await userEvent.click(await screen.findByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ returnTo: '/service-clients' });
  });
});

describe('sign-in errors (R2)', () => {
  it('offers a fresh login for authError=unavailable', async () => {
    renderAt('/login?authError=unavailable');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Sign-in didn't complete");
    expect(alert).toHaveTextContent('temporarily unavailable');
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/api/auth/login?returnTo=%2F');
  });

  it.each(['login_failed', 'invalid_state'])('shows a generic message with a retry for %s (AE2)', async (code) => {
    renderAt(`/login?authError=${code}`);
    const card = await findCard();
    expect(await card.findByRole('alert')).toHaveTextContent("Sign-in didn't complete");
    expect(card.getByRole('alert')).not.toHaveTextContent('temporarily unavailable');
    expect(card.getByRole('link', { name: 'Try again' })).toBeInTheDocument();
  });

  it('omits the retry for access_denied', async () => {
    renderAt('/login?authError=access_denied');
    expect(await screen.findByRole('alert')).toHaveTextContent("Sign-in didn't complete");
    expect(screen.queryByRole('link', { name: 'Try again' })).toBeNull();
  });

  it('shows nothing for an unknown code', async () => {
    renderAt('/login?authError=bogus');
    await screen.findByRole('heading', { level: 1, name: 'SDG Console' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
