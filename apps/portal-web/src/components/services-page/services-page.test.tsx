import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../../app';
import { createAppRouter } from '../../router';

vi.mock('../devtools', () => ({ Devtools: () => null }));

async function renderServices(path = '/services') {
  const queryClient = new QueryClient();
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

  it('collapses the sidebar to a rail with Open sidebar, and opens it again', async () => {
    await renderServices();
    await userEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
    const rail = screen.getByRole('complementary', { name: 'Search tools' });
    expect(within(rail).queryByRole('radiogroup')).toBeNull();
    await userEvent.click(within(rail).getByRole('button', { name: 'Open sidebar' }));
    expect(screen.getByRole('radiogroup', { name: 'Type' })).toBeInTheDocument();
  });

  it('lets a visitor pick a type without changing the results (presentational for now)', async () => {
    await renderServices();
    await userEvent.click(screen.getByRole('radio', { name: 'Service' }));
    expect(screen.getByRole('radio', { name: 'Service' })).toBeChecked();
    expect(screen.getByTestId('service-placeholders').children).toHaveLength(12);
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
});
