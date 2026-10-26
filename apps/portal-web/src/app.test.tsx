import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from './app';
import { createAppRouter } from './router';
import { headerQueries } from './test-support/header';

// Devtools render only in dev; keep them out of jsdom.
vi.mock('./components/devtools', () => ({ Devtools: () => null }));

function renderAt(path: string) {
  const queryClient = new QueryClient();
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [path] }) });
  render(<App queryClient={queryClient} router={router} />);
  return { queryClient, router };
}

describe('portal-web app shell', () => {
  describe('root layout', () => {
    it('renders the <sdg-header> with the title "SDG" as the only banner landmark', async () => {
      renderAt('/');
      const header = await headerQueries();
      const banners = header.getAllByRole('banner');
      expect(banners).toHaveLength(1);
      expect(banners[0]).toHaveClass('bcds-header');
      expect(within(banners[0]!).getByText('SDG')).toHaveClass('bcds-header--title');
      // The header's banner lives in its shadow root; the page itself adds none.
      expect(screen.queryAllByRole('banner')).toHaveLength(0);
    });

    it('renders the route content inside <main id="main-content"> and its container', async () => {
      renderAt('/');
      const main = await screen.findByRole('main');
      expect(screen.getAllByRole('main')).toHaveLength(1);
      expect(main).toHaveAttribute('id', 'main-content');
      expect(main).toHaveAttribute('tabindex', '-1');
      const heading = within(main).getByRole('heading', { level: 1 });
      expect(main.firstElementChild).toContainElement(heading);
    });

    it('renders the B.C. footer as the only contentinfo landmark', async () => {
      renderAt('/');
      const footers = await screen.findAllByRole('contentinfo');
      expect(footers).toHaveLength(1);
      expect(footers[0]).toHaveClass('bcds-footer');
      expect(footers[0]!.compareDocumentPosition(screen.getByRole('main'))).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    });

    it('links the header logo to "/" and provides a skip link to #main-content', async () => {
      renderAt('/');
      const header = await headerQueries();
      const logoLink = header.getByTitle('Government of British Columbia');
      expect(logoLink.tagName).toBe('A');
      expect(logoLink).toHaveAttribute('href', '/');
      expect(header.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main-content');
    });
  });

  describe('home route', () => {
    it('renders the home page heading at "/"', async () => {
      renderAt('/');
      const heading = await screen.findByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent('Welcome to SDG');
      expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
    });
  });

  describe('help route', () => {
    it('renders the help page at "/help" and marks the Help nav item current', async () => {
      renderAt('/help');
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Help');
      const nav = (await headerQueries()).getByRole('navigation', { name: 'Main' });
      await waitFor(() =>
        expect(within(nav).getByRole('link', { name: 'Help' })).toHaveAttribute('aria-current', 'page'),
      );
      expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
      expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    });

    it('navigates client-side from the header nav and moves the current item', async () => {
      const { router } = renderAt('/');
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Welcome to SDG');
      const header = await headerQueries();
      await userEvent.click(header.getByRole('link', { name: 'Help' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Help' })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/help');
      await waitFor(() => expect(header.getByRole('link', { name: 'Help' })).toHaveAttribute('aria-current', 'page'));
      expect(header.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    });
  });

  describe('not found', () => {
    it('renders "Page not found" and a link home inside the layout for an unknown path', async () => {
      renderAt('/does-not-exist');
      const main = await screen.findByRole('main');
      expect(await within(main).findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
      expect(within(main).getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/');
      expect((await headerQueries()).getByRole('banner')).toBeInTheDocument();
      expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    });
  });

  describe('router context', () => {
    it('exposes the QueryClient passed to createAppRouter on the router context', () => {
      const queryClient = new QueryClient();
      const router = createAppRouter({ queryClient });
      expect(router.options.context.queryClient).toBe(queryClient);
      expect(router.options.defaultPreload).toBe('intent');
      expect(router.options.defaultPreloadStaleTime).toBe(0);
    });
  });
});
