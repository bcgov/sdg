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

  describe('do more with a BC Services Card Account', () => {
    it('follows Find a service, with its description and three cards in a list', async () => {
      await renderHome();
      const region = screen.getByRole('region', { name: 'Do more with a BC Services Card Account' });
      const findService = screen.getByRole('region', { name: 'Find a service' });
      expect(findService.compareDocumentPosition(region)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(region).toHaveTextContent(
        'You can use your BC Services Card Account to securely access and manage government services online.',
      );

      const cards = within(region).getAllByRole('listitem');
      expect(cards.map((card) => within(card).getByRole('heading', { level: 3 }).textContent)).toEqual([
        'Discover Services',
        'Apply and track your requests',
        'Manage your information',
      ]);
      expect(cards[0]).toHaveTextContent('Browse and search for government services');
      expect(cards[1]).toHaveTextContent('Submit applications online and check the status of your requests.');
      expect(cards[2]).toHaveTextContent('View and update your information in one place.');
      for (const card of cards) expect(card.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(region.className).toMatch(/band/);
    });

    it('links every title to #', async () => {
      await renderHome();
      const region = screen.getByRole('region', { name: 'Do more with a BC Services Card Account' });
      expect(
        within(region)
          .getAllByRole('link')
          .map((link) => [link.textContent, link.getAttribute('href')]),
      ).toEqual([
        ['Discover Services', '#'],
        ['Apply and track your requests', '#'],
        ['Manage your information', '#'],
      ]);
    });
  });

  it('ends with two hidden placeholder blocks, one above the other, after the account section', async () => {
    await renderHome();
    const account = screen.getByRole('region', { name: 'Do more with a BC Services Card Account' });
    const [first, second, ...rest] = screen.getAllByTestId('home-placeholder');
    expect(rest).toEqual([]);
    expect(account.nextElementSibling).toBe(first);
    expect(first?.nextElementSibling).toBe(second);
    expect(second?.nextElementSibling).toBeNull();
    expect(first).toHaveAttribute('aria-hidden', 'true');
    expect(second).toHaveAttribute('aria-hidden', 'true');
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
