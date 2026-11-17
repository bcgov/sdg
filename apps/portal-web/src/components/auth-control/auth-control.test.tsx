import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../app';
import * as api from '../../auth/api';
import { currentUserQueryKey } from '../../auth/use-current-user';
import { createAppRouter } from '../../router';
import { headerQueries } from '../../test-support/header';

vi.mock('../devtools', () => ({ Devtools: () => null }));

const fetchMock = vi.fn<typeof fetch>();

function renderWith(response: () => Promise<Response>, path = '/') {
  fetchMock.mockImplementation(response);
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient();
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [path] }) });
  render(<App queryClient={queryClient} router={router} />);
  return { queryClient };
}

const signedIn = () => Promise.resolve(Response.json({ id: 'p-1', name: 'Ada Lovelace', email: 'ada@example.com' }));
const signedOut = () => Promise.resolve(Response.json({ statusCode: 401 }, { status: 401 }));

afterEach(() => {
  fetchMock.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useHeaderAuth', () => {
  describe('states', () => {
    it('Should render no auth control while the session check is pending', { timeout: 30_000 }, async () => {
      renderWith(() => new Promise<Response>(() => {}));
      const header = await headerQueries();
      expect(header.getByRole('banner')).toBeTruthy();
      expect(header.queryByRole('link', { name: 'Log In' })).toBeNull();
      expect(header.queryByRole('button', { name: 'Log Out' })).toBeNull();
      expect(document.querySelector('sdg-header')).not.toHaveAttribute('login-href');
      expect(document.querySelector('sdg-header')).not.toHaveAttribute('user-name');
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ credentials: 'same-origin' }));
    });

    it('Should render Log In linking to the BFF login when signed out', async () => {
      renderWith(signedOut, '/?tab=1');
      const header = await headerQueries();
      const link = await header.findByRole('link', { name: 'Log In' });
      expect(link).toHaveAttribute('href', '/api/auth/login?returnTo=%2F%3Ftab%3D1');
      expect(header.queryByRole('button', { name: 'Log Out' })).toBeNull();
    });

    it("Should render the user's name and Log Out when signed in, and log out from it", async () => {
      const logout = vi.spyOn(api, 'logout').mockResolvedValue();
      renderWith(signedIn);
      const header = await headerQueries();
      const logOut = await header.findByRole('button', { name: 'Log Out' });
      expect(header.getByText('Ada Lovelace')).toBeInTheDocument();
      expect(header.queryByRole('link', { name: 'Log In' })).toBeNull();
      await userEvent.click(logOut);
      expect(logout).toHaveBeenCalledTimes(1);
    });

    it('Should post the logout and clear the current user in the query cache (F3)', async () => {
      const logout = vi.spyOn(api, 'logout').mockImplementation(async (onSignedOut) => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        onSignedOut();
      });
      const { queryClient } = renderWith(signedIn);
      const header = await headerQueries();
      await userEvent.click(await header.findByRole('button', { name: 'Log Out' }));
      expect(logout).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
      expect(queryClient.getQueryData(currentUserQueryKey)).toBeNull();
      expect(await header.findByRole('link', { name: 'Log In' })).toBeInTheDocument();
      expect(header.queryByRole('button', { name: 'Log Out' })).toBeNull();
    });

    it('Should render Log In when the API errors, and log the error with context', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      renderWith(() => Promise.resolve(new Response('Bad gateway', { status: 502 })));
      const header = await headerQueries();
      expect(await header.findByRole('link', { name: 'Log In' })).toHaveAttribute(
        'href',
        '/api/auth/login?returnTo=%2F',
      );
      expect(consoleError).toHaveBeenCalledWith('portal-web: could not load the current user', expect.any(Error));
      // The flag list is fetched too; only the current-user request must not be retried.
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/me')).toHaveLength(1);
    });
  });

  describe('header', () => {
    it('Should be the single banner landmark, with a labelled nav landmark', async () => {
      renderWith(signedIn);
      const header = await headerQueries();
      const banners = header.getAllByRole('banner');
      expect(banners).toHaveLength(1);
      expect(banners[0]).toContainElement(await header.findByRole('button', { name: 'Log Out' }));
      expect(await header.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    });
  });
});
