import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../../app';
import type { CurrentUser } from '../../auth/api';
import { currentUserQueryKey } from '../../auth/use-current-user';
import { createAppRouter } from '../../router';

vi.mock('../devtools', () => ({ Devtools: () => null }));

/**
 * A controllable `(min-width: 1025px)` media query: starts narrow, and `growToWide()` resizes past the breakpoint
 * (firing `change` as a browser would).
 */
function stubViewport() {
  const wide = Object.assign(new EventTarget(), {
    matches: false,
    media: '(min-width: 1025px)',
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
  });
  vi.stubGlobal('matchMedia', (media: string) =>
    media === wide.media ? wide : Object.assign(new EventTarget(), { matches: true, media }),
  );
  return {
    growToWide: () =>
      act(() => {
        wide.matches = true;
        wide.dispatchEvent(Object.assign(new Event('change'), { matches: true, media: wide.media }));
      }),
  };
}

const RESIDENT: CurrentUser = { id: 'p-1', name: 'Ada Lovelace', email: null };

/**
 * Signed out unless a `user` is given, which is seeded into the session cache as if portal-api had answered; the
 * session's keep-alive then answers too, or its 401 would sign the user out.
 */
async function renderServices(path = '/services', user: CurrentUser | null = null) {
  if (user) {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ idleExpiresAt: Date.now() + 1_800_000 }))),
    );
  }
  const queryClient = new QueryClient();
  queryClient.setQueryData(currentUserQueryKey, user);
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [path] }) });
  render(<App queryClient={queryClient} router={router} />);
  await screen.findByRole('heading', { level: 1, name: 'Services' });
  return router;
}

describe('services page', () => {
  it('has the Services heading, its description and the services search', async () => {
    await renderServices();
    const main = screen.getByRole('main');
    expect(
      within(main).getByText('Find online application forms, service websites and government apps.'),
    ).toBeInTheDocument();
    const search = main.querySelector<HTMLElement>('search')!;
    expect(within(search).getByRole('textbox', { name: 'Search for services' })).toHaveValue('');
    expect(within(search).getByRole('button', { name: 'Search' })).toHaveAttribute('type', 'submit');
  });

  it('shows the query it arrived with in the search field', async () => {
    await renderServices('/services?q=fishing');
    expect(screen.getByRole('textbox', { name: 'Search for services' })).toHaveValue('fishing');
  });

  it('searches again from the field, like the home page', async () => {
    const router = await renderServices('/services?q=fishing');
    const field = screen.getByRole('textbox', { name: 'Search for services' });
    await userEvent.clear(field);
    await userEvent.type(field, ' parks {Enter}');
    expect(router.state.location.searchStr).toBe('?q=parks');
  });

  it('has a Search tools sidebar with a Type filter set to All', async () => {
    await renderServices();
    const tools = screen.getByRole('complementary', { name: 'Search tools' });
    expect(within(tools).getByRole('heading', { level: 2, name: 'Search tools' })).toBeInTheDocument();
    const type = within(tools).getByRole('radiogroup', { name: 'Type' });
    expect(
      within(type)
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent),
    ).toEqual(['All', 'Service', 'Platform']);
    expect(within(type).getByRole('radio', { name: 'All' })).toBeChecked();
  });

  it('collapses the sidebar to a rail with Show sidebar, and opens it again', async () => {
    await renderServices();
    const cards = screen.getByTestId('service-placeholders');
    expect(cards.className).not.toMatch(/cardsWide/);
    await userEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }));
    // Three cards a row while the sidebar is closed (wide screens only; see services-page.module.css).
    expect(cards.className).toMatch(/cardsWide/);
    const rail = screen.getByRole('complementary', { name: 'Search tools' });
    expect(within(rail).queryByRole('radiogroup')).toBeNull();
    await userEvent.click(within(rail).getByRole('button', { name: 'Show sidebar' }));
    expect(screen.getByRole('radiogroup', { name: 'Type' })).toBeInTheDocument();
    expect(cards.className).not.toMatch(/cardsWide/);
  });

  it('lets a visitor pick a type without changing the results (presentational for now)', async () => {
    await renderServices();
    await userEvent.click(screen.getByRole('radio', { name: 'Service' }));
    expect(screen.getByRole('radio', { name: 'Service' })).toBeChecked();
    expect(screen.getByTestId('service-placeholders').children).toHaveLength(12);
  });

  it('puts the Search tools icon button right after the Search button', async () => {
    await renderServices();
    const form = screen.getByRole('button', { name: 'Search' }).closest('form');
    if (!form) throw new Error('the Search button is not in a form');
    const buttons = within(form).getAllByRole('button');
    expect(buttons.map((button) => button.textContent || button.getAttribute('aria-label'))).toEqual([
      'Search',
      'Search tools',
    ]);
  });

  it('names the Search tools icon button in a tooltip on hover', async () => {
    await renderServices();
    await userEvent.hover(screen.getByRole('button', { name: 'Search tools' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Search tools');
  });

  it('opens Search tools as a dialog that shares the sidebar’s choice, and Show results closes it', async () => {
    await renderServices();
    await userEvent.click(screen.getByRole('radio', { name: 'Platform' }));
    await userEvent.click(screen.getByRole('button', { name: 'Search tools' }));
    const sheet = await screen.findByRole('dialog', { name: 'Search tools' });
    expect(within(sheet).getByRole('radio', { name: 'Platform' })).toBeChecked();

    await userEvent.click(within(sheet).getByRole('radio', { name: 'Service' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Show results' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('radio', { name: 'Service' })).toBeChecked();
  });

  it('closes the sheet when the dimmed area around it is clicked', async () => {
    await renderServices();
    await userEvent.click(screen.getByRole('button', { name: 'Search tools' }));
    const sheet = await screen.findByRole('dialog', { name: 'Search tools' });
    // The dimmed backdrop is react-aria's overlay around the sheet, outside the modal box.
    const backdrop = sheet.closest('.react-aria-ModalOverlay');
    if (!backdrop) throw new Error('the sheet has no modal overlay');
    await userEvent.click(backdrop);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('resets the type to All from Clear all, and closes from the close button', async () => {
    await renderServices();
    await userEvent.click(screen.getByRole('button', { name: 'Search tools' }));
    const sheet = await screen.findByRole('dialog', { name: 'Search tools' });
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Service' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Clear all' }));
    expect(within(sheet).getByRole('radio', { name: 'All' })).toBeChecked();

    await userEvent.click(within(sheet).getByRole('button', { name: 'Close search tools' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes the dialog on Escape', async () => {
    await renderServices();
    await userEvent.click(screen.getByRole('button', { name: 'Search tools' }));
    await screen.findByRole('dialog', { name: 'Search tools' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('swaps an open sheet for the expanded sidebar when the screen grows to the wide layout', async () => {
    const viewport = stubViewport();
    await renderServices();
    // Collapsed on wide screens earlier; the sheet is then opened at a narrower width.
    await userEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Search tools' }));
    const sheet = await screen.findByRole('dialog', { name: 'Search tools' });
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Platform' }));

    viewport.growToWide();

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const sidebar = screen.getByRole('complementary', { name: 'Search tools' });
    expect(within(sidebar).getByRole('radio', { name: 'Platform' })).toBeChecked();
  });

  it('leaves the sidebar as it was when the screen grows to the wide layout with the sheet closed', async () => {
    const viewport = stubViewport();
    await renderServices();
    await userEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }));
    // A filter changed in the sheet, which is then closed, still holds in the sidebar.
    await userEvent.click(screen.getByRole('button', { name: 'Search tools' }));
    const sheet = await screen.findByRole('dialog', { name: 'Search tools' });
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Service' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Show results' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    viewport.growToWide();

    const rail = screen.getByRole('complementary', { name: 'Search tools' });
    expect(within(rail).getByRole('button', { name: 'Show sidebar' })).toBeInTheDocument();
    await userEvent.click(within(rail).getByRole('button', { name: 'Show sidebar' }));
    expect(screen.getByRole('radio', { name: 'Service' })).toBeChecked();
  });

  it('shows twelve hidden placeholder cards', async () => {
    await renderServices();
    const cards = screen.getByTestId('service-placeholders');
    expect(cards).toHaveAttribute('aria-hidden', 'true');
    expect(cards.children).toHaveLength(12);
  });

  it('has pagination on page 1 of 3, with Previous disabled, and the results count', async () => {
    await renderServices();
    const pagination = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(pagination).getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(within(pagination).getByRole('button', { name: 'Next page' })).toBeEnabled();
    expect(within(pagination).getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
    expect(within(pagination).getByRole('button', { name: 'Page 2' })).not.toHaveAttribute('aria-current');
    expect(pagination).toHaveTextContent('Showing results 1 - 12 of 36 services');
  });

  it('ends with the Still can’t find what you’re looking for? panel and its contact link', async () => {
    await renderServices();
    const panel = screen.getByRole('region', { name: 'Still can’t find what you’re looking for?' });
    expect(panel).toHaveTextContent('We can help in over 220 languages and through other accessible options.');
    const link = within(panel).getByRole('link', { name: 'Find ways to contact us (opens in a new tab)' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('navigation', { name: 'Pagination' }).compareDocumentPosition(panel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('has no tabs for a signed-out visitor', async () => {
    await renderServices();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByTestId('service-placeholders').children).toHaveLength(12);
  });

  it('gives a signed-in resident All Services and Bookmarks tabs, on All Services', async () => {
    await renderServices('/services', RESIDENT);
    const tabs = await screen.findByRole('tablist', { name: 'Services' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['All Services', 'Bookmarks']);
    expect(within(tabs).getByRole('tab', { name: 'All Services' })).toHaveAttribute('aria-selected', 'true');
    // The tabs sit between the header and the cards.
    const header = screen.getByRole('heading', { level: 1, name: 'Services' }).closest('header')!;
    expect(header.compareDocumentPosition(tabs)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const panel = screen.getByRole('tabpanel', { name: 'All Services' });
    expect(within(panel).getByTestId('service-placeholders').children).toHaveLength(12);
    expect(within(panel).getByRole('navigation', { name: 'Pagination' })).toHaveTextContent(
      'Showing results 1 - 12 of 36 services',
    );
  });

  it('shows three placeholder bookmarks on one page in the Bookmarks tab', async () => {
    await renderServices('/services', RESIDENT);
    await userEvent.click(await screen.findByRole('tab', { name: 'Bookmarks' }));
    const panel = screen.getByRole('tabpanel', { name: 'Bookmarks' });
    expect(within(panel).getByTestId('bookmark-placeholders').children).toHaveLength(3);
    expect(screen.queryByTestId('service-placeholders')).toBeNull();
    const pagination = within(panel).getByRole('navigation', { name: 'Pagination' });
    expect(within(pagination).getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
    expect(within(pagination).queryByRole('button', { name: 'Page 2' })).toBeNull();
    expect(within(pagination).getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(pagination).toHaveTextContent('Showing results 1 - 3 of 3 bookmarks');
    // The help panel stays under whichever tab is showing.
    expect(screen.getByRole('region', { name: 'Still can’t find what you’re looking for?' })).toBeInTheDocument();
  });
});
