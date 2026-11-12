import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ADMIN } from '../../test-support/fake-console-api';
import { renderMobileShell } from '../../test-support/shell';
import { SIDEBAR_STORAGE_KEY } from './sidebar-context';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

type User = ReturnType<typeof userEvent.setup>;

async function openPanel(user: User, toggle: HTMLElement) {
  await user.click(toggle);
  return screen.findByRole('dialog', { name: 'Navigation' });
}

const panelClosed = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

describe('the mobile panel (R13)', () => {
  it('shows no sidebar until "Open navigation" opens a Navigation dialog with the navs and the account button', async () => {
    // The panel is never the icon rail, whatever the desktop choice is.
    localStorage.setItem(SIDEBAR_STORAGE_KEY, 'collapsed');
    const user = userEvent.setup();
    const { toggle } = await renderMobileShell('/');
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    const panel = await openPanel(user, toggle);
    expect(within(panel).getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(within(panel).getByRole('navigation', { name: 'Secondary' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: `Account menu for ${ADMIN.name}` })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Search' }).querySelector('kbd')).not.toBeNull();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes when Settings is chosen, and /settings shows (AE5)', async () => {
    const user = userEvent.setup();
    const { router, toggle } = await renderMobileShell('/');
    const panel = await openPanel(user, toggle);
    await user.click(within(panel).getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings');
    await panelClosed();
  });

  it('closes on Escape and returns focus to the toggle', async () => {
    const user = userEvent.setup();
    const { toggle } = await renderMobileShell('/');
    await openPanel(user, toggle);
    await user.keyboard('{Escape}');
    await panelClosed();
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it('closes on a press outside it', async () => {
    const user = userEvent.setup();
    const { toggle } = await renderMobileShell('/');
    const panel = await openPanel(user, toggle);
    const overlay = panel.closest('.react-aria-ModalOverlay');
    if (!(overlay instanceof HTMLElement)) throw new Error('the panel has no overlay');
    await user.click(overlay);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument());
  });

  it('opens and closes with Ctrl+B, leaving the stored desktop choice alone', async () => {
    const user = userEvent.setup();
    await renderMobileShell('/');
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    await user.keyboard('{Control>}b{/Control}');
    expect(await screen.findByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();
    await user.keyboard('{Control>}b{/Control}');
    await panelClosed();
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe(stored);
  });

  it('closes and opens a focused Search dialog, not aria-hidden, when Search is pressed inside it (KTD7)', async () => {
    const user = userEvent.setup();
    const { toggle } = await renderMobileShell('/');
    const panel = await openPanel(user, toggle);
    await user.click(within(panel).getByRole('button', { name: 'Search' }));
    const palette = await screen.findByRole('dialog', { name: 'Search' });
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
    await waitFor(() => expect(within(palette).getByRole('searchbox')).toHaveFocus());
    expect(palette.closest('[aria-hidden="true"], [inert]')).toBeNull();
  });

  it('closes when the screen widens, and the desktop sidebar shows in its stored state', async () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, 'collapsed');
    const user = userEvent.setup();
    const { toggle, viewport } = await renderMobileShell('/');
    await openPanel(user, toggle);
    viewport.set(false);
    await panelClosed();
    const expand = await screen.findByRole('button', { name: 'Expand sidebar' });
    expect(document.getElementById(expand.getAttribute('aria-controls') ?? '')).toHaveAttribute(
      'data-state',
      'collapsed',
    );
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('collapsed');
  });
});
