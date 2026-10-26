import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../app';
import * as api from '../../auth/api';
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
    it('renders no account control while loading', async () => {
      renderWith(() => new Promise<Response>(() => {}));
      const header = await headerQueries();
      expect(header.getByRole('banner')).toBeTruthy();
      expect(header.queryByRole('link', { name: 'Sign in' })).toBeNull();
      expect(header.queryByRole('button', { name: /Account menu/ })).toBeNull();
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ credentials: 'same-origin' }));
    });

    it('renders a Sign in nav link when signed out', async () => {
      renderWith(signedOut, '/?tab=1');
      const header = await headerQueries();
      const link = await header.findByRole('link', { name: 'Sign in' });
      expect(link).toHaveAttribute('href', '/api/auth/login?returnTo=%2F%3Ftab%3D1');
      expect(link).toHaveClass('nav-link');
      expect(header.queryByRole('button', { name: /Account menu/ })).toBeNull();
    });

    it('renders the account menu when signed in, and logs out from it', async () => {
      const logout = vi.spyOn(api, 'logout').mockResolvedValue();
      renderWith(signedIn);
      const header = await headerQueries();
      await userEvent.click(await header.findByRole('button', { name: 'Account menu for Ada Lovelace' }));
      const menu = await header.findByRole('menu');
      expect(within(menu).getByText('ada@example.com')).toBeTruthy();
      await userEvent.click(within(menu).getByRole('menuitem', { name: 'Log out' }));
      expect(logout).toHaveBeenCalledTimes(1);
      expect(header.queryByRole('link', { name: 'Sign in' })).toBeNull();
    });

    it('renders Sign in when the API errors', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      renderWith(() => Promise.resolve(new Response('Bad gateway', { status: 502 })));
      const header = await headerQueries();
      expect(await header.findByRole('link', { name: 'Sign in' })).toHaveAttribute(
        'href',
        '/api/auth/login?returnTo=%2F',
      );
      expect(consoleError).toHaveBeenCalledWith('portal-web: could not load the current user', expect.any(Error));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('narrow screens', () => {
    it('collapses Sign in behind the Menu button', async () => {
      vi.stubGlobal('matchMedia', (media: string) => ({
        matches: true,
        media,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
      renderWith(signedOut);
      const header = await headerQueries();
      const toggle = await header.findByRole('button', { name: 'Menu' });
      await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));
      expect(header.queryByRole('link', { name: 'Sign in' })).toBeNull();
      await userEvent.click(toggle);
      expect(await header.findByRole('link', { name: 'Sign in' })).toHaveAttribute(
        'href',
        '/api/auth/login?returnTo=%2F',
      );
    });
  });

  describe('header', () => {
    it('sits inside the single banner landmark', async () => {
      renderWith(signedIn);
      const header = await headerQueries();
      const banners = header.getAllByRole('banner');
      expect(banners).toHaveLength(1);
      const trigger = await header.findByRole('button', { name: 'Account menu for Ada Lovelace' });
      expect(banners[0]!.querySelector('.bcds-header--container')).toContainElement(trigger);
    });
  });
});
