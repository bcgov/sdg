import { FLAGS_PATH } from '@repo/feature-flags';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './app';
import { createAppRouter } from './router';
import { headerQueries } from './test-support/header';

// Devtools render only in dev; keep them out of jsdom.
vi.mock('./components/devtools', () => ({ Devtools: () => null }));

afterEach(() => {
  vi.restoreAllMocks();
});

function renderAt(path: string) {
  const queryClient = new QueryClient();
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [path] }) });
  render(<App queryClient={queryClient} router={router} />);
  return { queryClient, router };
}

/** The search the /services route validated, as its component reads it. */
function servicesSearch(router: ReturnType<typeof createAppRouter>) {
  return router.state.matches.find((match) => match.routeId === '/services')?.search;
}

describe('portal-web app shell', () => {
  describe('root layout', () => {
    it('renders the <sdg-header> with the title "SDG" as the only banner landmark', async () => {
      renderAt('/');
      const header = await headerQueries();
      const banners = header.getAllByRole('banner');
      expect(banners).toHaveLength(1);
      expect(within(banners[0]!).getByText('SDG')).toBeInTheDocument();
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

    it('provides a skip link to #main-content before the header', async () => {
      renderAt('/');
      const skipLink = await screen.findByRole('link', { name: 'Skip to main content' });
      expect(skipLink).toHaveAttribute('href', '#main-content');
      expect(skipLink.compareDocumentPosition(document.querySelector('sdg-header')!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
  });

  describe('home route', () => {
    it('renders the home page heading at "/"', async () => {
      renderAt('/');
      const heading = await screen.findByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent('Access services online');
      expect(screen.queryByText('Error 404 - Page not found')).not.toBeInTheDocument();
    });

    it('Should fetch the flags once and still render the page when the flag list fails (R7, R8, AE8)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      renderAt('/');
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Access services online');
      // test-setup answers every request 401, the flag list included.
      await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      const inputs = vi.mocked(fetch).mock.calls.map(([input]) => input);
      expect(inputs.filter((input) => input === FLAGS_PATH)).toHaveLength(1);
    });
  });

  describe('services route', () => {
    it('renders the Services page at "/services" and marks its nav item current', async () => {
      renderAt('/services');
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Services');
      await headerQueries();
      const nav = within(document.querySelector('sdg-header')!);
      await waitFor(() => expect(nav.getByRole('link', { name: 'Services' })).toHaveAttribute('aria-current', 'page'));
      expect(nav.getByRole('link', { name: 'Services' })).toHaveAttribute('href', '/services');
      expect(nav.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    });

    it('keeps a search query from "?q=" as a string', async () => {
      const { router } = renderAt('/services?q=dog');
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Services');
      expect(servicesSearch(router)).toEqual({ q: 'dog' });
    });

    it.each(['007', '1e3', 'true', 'null'])('keeps the query "%s" exactly as typed in the URL', async (query) => {
      const { router } = renderAt(`/services?q=${query}`);
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Services');
      expect(servicesSearch(router)).toEqual({ q: query });
    });

    it.each(['/services', '/services?q=', '/services?q=%20%20'])('has no search query at "%s"', async (path) => {
      const { router } = renderAt(path);
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Services');
      expect(servicesSearch(router)).toEqual({});
    });
  });

  describe('help route', () => {
    it('renders the Help page at "/help" and marks its nav item current', async () => {
      renderAt('/help');
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Help');
      await headerQueries();
      const nav = within(document.querySelector('sdg-header')!);
      await waitFor(() => expect(nav.getByRole('link', { name: 'Help' })).toHaveAttribute('aria-current', 'page'));
      expect(nav.getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/help');
      expect(nav.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    });

    it('lists the nav items in order: Home, Services, Help, Contact us', async () => {
      renderAt('/');
      await headerQueries();
      const links = [...document.querySelectorAll('sdg-header a[slot="nav"]')].map((a) => a.textContent);
      expect(links).toEqual(['Home', 'Services', 'Help', 'Contact us']);
    });
  });

  describe('contact us route', () => {
    it('renders the Contact us page at "/contact-us" and marks its nav item current', async () => {
      renderAt('/contact-us');
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Contact us');
      expect((await headerQueries()).getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
      // Nav items are the app's own links, slotted into the header from the light DOM.
      const nav = within(document.querySelector('sdg-header')!);
      await waitFor(() =>
        expect(nav.getByRole('link', { name: 'Contact us' })).toHaveAttribute('aria-current', 'page'),
      );
      expect(nav.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
      expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
      expect(nav.getByRole('link', { name: 'Contact us' })).toHaveAttribute('slot', 'nav');
    });

    it('navigates client-side from the header nav and moves the current item', async () => {
      const { router } = renderAt('/');
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Access services online');
      await headerQueries();
      const header = within(document.querySelector('sdg-header')!);
      await userEvent.click(header.getByRole('link', { name: 'Contact us' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Contact us' })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/contact-us');
      await waitFor(() =>
        expect(header.getByRole('link', { name: 'Contact us' })).toHaveAttribute('aria-current', 'page'),
      );
      expect(header.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    });
  });

  describe('not found', () => {
    it('renders the 404 page, with links home, to Services and to Help, inside the layout for an unknown path', async () => {
      renderAt('/does-not-exist');
      const main = await screen.findByRole('main');
      expect(
        await within(main).findByRole('heading', { level: 1, name: 'Oops, looks like we’re lost' }),
      ).toBeInTheDocument();
      expect(within(main).getByText('Error 404 - Page not found')).toBeInTheDocument();
      expect(within(main).getByRole('separator')).toBeInTheDocument();
      expect(within(main).getByRole('link', { name: 'Home Page' })).toHaveAttribute('href', '/');
      expect(within(main).getByRole('link', { name: 'Services' })).toHaveAttribute('href', '/services');
      expect(within(main).getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/help');
      for (const name of ['Home Page', 'Services', 'Help']) {
        expect(within(main).getByRole('link', { name }).className).toMatch(/link/);
      }
      expect(within(within(main).getAllByRole('list')[0]!).getAllByRole('listitem')).toHaveLength(3);
      const contact = within(main).getByRole('region', { name: 'Contact information' });
      expect(contact.previousElementSibling).toHaveTextContent('We suggest:');
      expect(within(contact).getByRole('link', { name: '711' })).toHaveAttribute('href', 'tel:711');
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
