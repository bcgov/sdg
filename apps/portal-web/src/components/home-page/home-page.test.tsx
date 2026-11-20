import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../../app';
import { createAppRouter } from '../../router';

// Devtools render only in dev; keep them out of jsdom.
vi.mock('../devtools', () => ({ Devtools: () => null }));

async function renderHome(path = '/') {
  const queryClient = new QueryClient();
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [path] }) });
  render(<App queryClient={queryClient} router={router} />);
  await screen.findByRole('heading', { level: 1, name: 'Access services online' });
  return router;
}

/** Waits for the router to settle on /services and returns the search its route validated. */
async function landedOnServices(router: ReturnType<typeof createAppRouter>) {
  await screen.findByRole('heading', { level: 1, name: 'Services' });
  expect(router.state.location.pathname).toBe('/services');
  return router.state.matches.find((match) => match.routeId === '/services')?.search;
}

describe('home page', () => {
  describe('hero', () => {
    it('has one h1, "Access services online", and the lede', async () => {
      await renderHome();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByText('Find services, track application statuses and manage your profile', { selector: 'p' }),
      ).toBeInTheDocument();
      expect(screen.queryByText('Welcome to SDG')).not.toBeInTheDocument();
    });
  });

  describe('search', () => {
    // jsdom doesn't map <search> to the search landmark yet; e2e/layout.spec.ts checks the role in real browsers.
    it('is a <search> element with a labelled field and a Search button', async () => {
      await renderHome();
      const search = document.querySelector<HTMLElement>('main search')!;
      const field = within(search).getByRole('textbox', { name: 'Search for services' });
      expect(field).toHaveAttribute('placeholder', 'Search for services');
      expect(within(search).getByRole('button', { name: 'Search' })).toHaveAttribute('type', 'submit');
    });

    it('goes to /services with the trimmed query on Enter', async () => {
      const router = await renderHome();
      await userEvent.type(screen.getByRole('textbox', { name: 'Search for services' }), '  dog licence {Enter}');
      expect(await landedOnServices(router)).toEqual({ q: 'dog licence' });
    });

    it('goes to /services with the query when Search is clicked', async () => {
      const router = await renderHome();
      await userEvent.type(screen.getByRole('textbox', { name: 'Search for services' }), 'fishing');
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));
      expect(await landedOnServices(router)).toEqual({ q: 'fishing' });
      expect(router.state.location.searchStr).toBe('?q=fishing');
    });

    it('writes a number-like query into the URL as plain text', async () => {
      const router = await renderHome();
      await userEvent.type(screen.getByRole('textbox', { name: 'Search for services' }), '007{Enter}');
      expect(await landedOnServices(router)).toEqual({ q: '007' });
      expect(router.state.location.searchStr).toBe('?q=007');
    });

    it.each(['', '   '])('goes to plain /services for the query "%s"', async (query) => {
      const router = await renderHome();
      if (query) await userEvent.type(screen.getByRole('textbox', { name: 'Search for services' }), query);
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));
      expect(await landedOnServices(router)).toEqual({});
      expect(router.state.location.searchStr).toBe('');
    });
  });

  describe('find a service', () => {
    it('has its description, six hidden placeholders, then a View all services link', async () => {
      await renderHome();
      const region = screen.getByRole('region', { name: 'Find a service' });
      expect(within(region).getByText('Choose from popular options or browse the full list.')).toBeInTheDocument();
      const link = within(region).getByRole('link', { name: 'View all services' });
      expect(link).toHaveAttribute('href', '/services');

      // The section's yellow accent bar is an aria-hidden <span>; the placeholder grid is the aria-hidden <div>.
      const grid = region.querySelector('div[aria-hidden="true"]')!;
      expect(grid.children).toHaveLength(6);
      expect(grid.compareDocumentPosition(link)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('navigates to /services from View all services', async () => {
      const router = await renderHome();
      await userEvent.click(screen.getByRole('link', { name: 'View all services' }));
      expect(await landedOnServices(router)).toEqual({});
    });
  });

  it('still shows and dismisses an auth-error notice above the hero', async () => {
    const router = await renderHome('/?authError=login_failed');
    const main = screen.getByRole('main');
    const heading = within(main).getByRole('heading', { level: 1 });
    const dismiss = await within(main).findByRole('button', { name: /close|dismiss/i });
    expect(dismiss.compareDocumentPosition(heading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await userEvent.click(dismiss);
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('authError'));
  });
});
