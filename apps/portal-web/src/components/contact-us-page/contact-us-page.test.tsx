import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../../app';
import { createAppRouter } from '../../router';

// Devtools render only in dev; keep them out of jsdom.
vi.mock('../devtools', () => ({ Devtools: () => null }));

async function renderContactUs() {
  const queryClient = new QueryClient();
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: ['/contact-us'] }) });
  render(<App queryClient={queryClient} router={router} />);
  await screen.findByRole('heading', { level: 1, name: 'Contact us' });
}

describe('Contact us page', () => {
  it('has one h1 and no "Last updated" line', async () => {
    await renderContactUs();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByText(/Last updated/u)).not.toBeInTheDocument();
  });

  it('lists what the Service BC Help Desk can help with', async () => {
    await renderContactUs();
    const intro = screen.getByText(/Contact the Service BC Help Desk/u);
    const list = intro.nextElementSibling;
    if (!(list instanceof HTMLElement)) throw new Error('No list after the intro');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Set up the BC Services Card app',
      'Set up your username and password',
      'Get a BC Token',
      'Log in to a website',
    ]);
  });

  it('numbers the two "Before you call" steps, the first linking to the support guide in new tabs', async () => {
    await renderContactUs();
    const section = screen.getByRole('region', { name: 'Before you call' });
    const steps = within(section).getAllByRole('heading', { level: 3 });
    expect(steps.map((step) => step.textContent)).toEqual(['Check the support guide', 'Have these ready, if you can']);
    expect(section.querySelector('ol')).not.toBeNull();

    const guide = within(section).getByRole('link', { name: 'How to get a BC Token (opens in a new tab)' });
    expect(guide).toHaveAttribute('href', 'https://id.gov.bc.ca/account/token-setup-instruction');
    expect(guide).toHaveAttribute('target', '_blank');
    expect(within(section).getAllByRole('link')).toHaveLength(3);
    expect(within(section).getByText('What happened, including any error message')).toBeInTheDocument();
  });

  it('ends with Service BC’s contact information', async () => {
    await renderContactUs();
    const panel = screen.getByRole('region', { name: 'Contact information' });
    expect(within(panel).getByRole('link', { name: '1-888-356-2741' })).toHaveAttribute('href', 'tel:18883562741');
  });
});
