import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from './api/query-client';
import * as api from './auth/api';
import { currentUserQueryKey } from './auth/use-current-user';
import { createAppRouter } from './router';
import { ADMIN, fakeAdminApi } from './test-support/fake-admin-api';
import { headerQueries } from './test-support/header';
import { renderAt } from './test-support/render';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('admin-web app shell', () => {
  it('renders <sdg-header> titled "SDG Admin" as the only banner, with a skip link to #main-content', async () => {
    renderAt('/');
    const header = await headerQueries();
    const banners = header.getAllByRole('banner');
    expect(banners).toHaveLength(1);
    expect(within(banners[0]!).getByText('SDG Admin')).toHaveClass('bcds-header--title');
    expect(header.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main-content');
    expect(screen.queryAllByRole('banner')).toHaveLength(0);
  });

  it('renders route content in <main id="main-content"> above the B.C. footer', async () => {
    renderAt('/');
    const main = await screen.findByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(within(main).getByRole('heading', { level: 1 })).toHaveTextContent('SDG administration');
    expect(screen.getByRole('contentinfo')).toHaveClass('bcds-footer');
  });

  it('renders "Page not found" for an unknown path', async () => {
    renderAt('/does-not-exist');
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('shares the QueryClient with the router context', () => {
    const queryClient = createQueryClient();
    expect(createAppRouter({ queryClient }).options.context.queryClient).toBe(queryClient);
  });
});

describe('header account control (R15)', () => {
  it("shows the administrator's name with Log out when signed in, and signs out through admin-api", async () => {
    fakeAdminApi();
    const logout = vi.spyOn(api, 'logout').mockImplementation(async (onSignedOut) => {
      onSignedOut();
    });
    const { queryClient } = renderAt('/');
    const header = await headerQueries();
    await userEvent.click(await header.findByRole('button', { name: `Account menu for ${ADMIN.name}` }));
    const menu = await header.findByRole('menu');
    expect(within(menu).getByText(ADMIN.email)).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Log out' }));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(currentUserQueryKey)).toBeNull();
    expect(await header.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('marks the Service accounts nav item current on its page', async () => {
    fakeAdminApi();
    renderAt('/service-clients');
    const nav = (await headerQueries()).getByRole('navigation', { name: 'Main' });
    await waitFor(() =>
      expect(within(nav).getByRole('link', { name: 'Service accounts' })).toHaveAttribute('aria-current', 'page'),
    );
  });

  it('shows Sign in and logs the error when admin-api is unreachable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.resolve(new Response('Bad gateway', { status: 502 }))),
    );
    renderAt('/');
    const header = await headerQueries();
    expect(await header.findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2F',
    );
    expect(consoleError).toHaveBeenCalledWith('admin-web: could not load the current user', expect.any(Error));
  });
});
