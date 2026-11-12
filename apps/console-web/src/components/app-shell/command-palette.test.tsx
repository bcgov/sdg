import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeConsoleApi } from '../../test-support/fake-console-api';
import { renderAt } from '../../test-support/render';
import { renderShell } from '../../test-support/shell';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

type User = ReturnType<typeof userEvent.setup>;

// react-aria wraps the empty state in a `menuitem`, so "No results" is the one item left when nothing matches.
const itemNames = (dialog: HTMLElement) =>
  within(dialog)
    .queryAllByRole('menuitem')
    .map((item) => item.textContent);

async function openFromSearch(user: User, sidebar: HTMLElement) {
  await user.click(within(sidebar).getByRole('button', { name: 'Search' }));
  return screen.findByRole('dialog', { name: 'Search' });
}

describe('the command palette (R8, R14)', () => {
  it('opens from Search as a dialog named Search, with the input focused and the four destinations', async () => {
    const user = userEvent.setup();
    const { sidebar } = await renderShell('/');
    const dialog = await openFromSearch(user, sidebar);
    expect(within(dialog).getByRole('searchbox')).toHaveFocus();
    expect(itemNames(dialog)).toEqual(['Dashboard', 'Service Accounts', 'Settings', 'Get help']);
  });

  it('filters as the administrator types, and says when nothing matches', async () => {
    const user = userEvent.setup();
    const { sidebar } = await renderShell('/');
    const dialog = await openFromSearch(user, sidebar);
    await user.keyboard('serv');
    expect(itemNames(dialog)).toEqual(['Service Accounts']);
    await user.clear(within(dialog).getByRole('searchbox'));
    await user.keyboard('zzz');
    expect(itemNames(dialog)).toEqual(['No results']);
  });

  it('goes to the chosen destination with Enter and closes', async () => {
    const user = userEvent.setup();
    const { router, sidebar } = await renderShell('/');
    await openFromSearch(user, sidebar);
    await user.keyboard('sett{ArrowDown}{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes on Escape and returns focus to the Search button', async () => {
    const user = userEvent.setup();
    const { sidebar } = await renderShell('/');
    await openFromSearch(user, sidebar);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(within(sidebar).getByRole('button', { name: 'Search' })).toHaveFocus());
  });

  it('adds no <style> beyond react-aria’s two fixed ones, which the edge CSP allows by hash (R17)', async () => {
    const user = userEvent.setup();
    const { sidebar } = await renderShell('/');
    // Vitest injects the app's own CSS as <style> elements; only those the palette adds count here.
    const before = new Set(document.querySelectorAll('style'));
    await openFromSearch(user, sidebar);
    const added = Array.from(document.querySelectorAll('style'))
      .filter((style) => !before.has(style))
      .map((style) => style.textContent);
    expect(added.filter((text) => !/touch-action|overscroll-behavior/.test(text))).toEqual([]);
  });
});

describe('the palette shortcut (R8, KTD7)', () => {
  it.each([
    ['Ctrl+K', '{Control>}k{/Control}'],
    ['Meta+K', '{Meta>}k{/Meta}'],
  ])('opens the palette with %s from anywhere in the shell', async (_, keys) => {
    const user = userEvent.setup();
    await renderShell('/service-clients');
    await user.keyboard(keys);
    expect(await screen.findByRole('dialog', { name: 'Search' })).toBeInTheDocument();
  });

  it('does nothing on the sign-in card', async () => {
    fakeConsoleApi({ signedIn: false });
    const user = userEvent.setup();
    renderAt('/login');
    await screen.findByRole('link', { name: 'Sign in' });
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
