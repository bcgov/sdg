import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../../app';
import { createAppRouter } from '../../router';

// Devtools render only in dev; keep them out of jsdom.
vi.mock('../devtools', () => ({ Devtools: () => null }));

async function renderHelp() {
  const queryClient = new QueryClient();
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: ['/help'] }) });
  render(<App queryClient={queryClient} router={router} />);
  await screen.findByRole('heading', { level: 1, name: 'Help' });
}

describe('Help page', () => {
  it('has one h1 and no "Last updated" line', async () => {
    await renderHelp();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByText(/Last updated/u)).not.toBeInTheDocument();
  });

  it('links each "On this page" entry to a section on the page with that id', async () => {
    await renderHelp();
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'BC Services Card Account setup',
      'About Single Digital Gateway',
      'Services and Platforms',
      'Data & Privacy',
      'Contact information',
    ]);
    for (const link of links) {
      const hash = new URL(link.getAttribute('href')!, 'https://portal.test').hash;
      const target = document.getElementById(hash.slice(1));
      if (target === null) throw new Error(`No element with the id ${hash}`);
      expect(within(target).getAllByRole('heading')[0]).toHaveTextContent(link.textContent ?? '');
    }
  });

  it('shows the seven account set-up topics as h3s, each with links that open in a new tab', async () => {
    await renderHelp();
    const section = screen.getByRole('region', { name: 'BC Services Card Account setup' });
    expect(
      within(section)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([
      'Mobile app',
      'Username, password and BC Token',
      'Verifying your identity',
      'Where to find information',
      'Login and how to use',
      'Wallet',
      'Managing your account',
    ]);
    const links = within(section).getAllByRole('link');
    expect(links).toHaveLength(25);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('aria-label')).toMatch(/\(opens in a new tab\)$/u);
    }
    const setUp = within(section).getByRole('link', {
      name: 'How to set up a username and password (opens in a new tab)',
    });
    expect(setUp).toHaveAttribute('href', 'https://id.gov.bc.ca/account/token');
    expect(setUp.parentElement).toHaveTextContent(
      'How to set up a username and password - if you already have a BC Token',
    );
    expect(within(section).getByText('A BC Token').tagName).toBe('FIGCAPTION');
  });

  it('explains each service tag in a table and links to all services', async () => {
    await renderHelp();
    const section = screen.getByRole('region', { name: 'Services and Platforms' });
    const table = within(section).getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Tag', 'Description']);
    // The table's own rows: each tag is a react-aria grid with rows of its own.
    const rows = [...table.querySelectorAll<HTMLTableRowElement>(':scope > tbody > tr')];
    expect(rows.map((row) => row.cells[1]?.textContent)).toEqual([
      'An online form or application you complete, like Change your address.',
      'A website or app where you can do several things, like Health Gateway. It opens in its own site.',
      'A platform run by the Government of Canada, like Canada Revenue Agency - CRA Account.',
    ]);
    expect(rows.map((row) => row.cells[0]?.textContent)).toEqual(['Service', 'Platform', 'Platform']);
    expect(within(section).getByRole('link', { name: 'Browse all services' })).toHaveAttribute('href', '/services');
  });

  it('links to the B.C. government’s disclaimer, privacy, accessibility and copyright pages', async () => {
    await renderHelp();
    const section = screen.getByRole('region', { name: 'Data & Privacy' });
    expect(
      within(section)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Disclaimer', 'Privacy', 'Accessibility', 'Copyright']);
  });

  it('ends with Service BC’s contact information', async () => {
    await renderHelp();
    expect(screen.getByRole('region', { name: 'Contact information' })).toBeInTheDocument();
  });
});
