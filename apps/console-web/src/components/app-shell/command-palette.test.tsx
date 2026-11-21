import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeConsoleApi } from '../../test-support/fake-console-api';
import { renderAt } from '../../test-support/render';
import { renderMobileShell, renderShell } from '../../test-support/shell';

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
  it('opens from Search as a dialog named Search, with the input focused and the five destinations', async () => {
    const user = userEvent.setup();
    const { sidebar } = await renderShell('/');
    const dialog = await openFromSearch(user, sidebar);
    expect(within(dialog).getByRole('searchbox')).toHaveFocus();
    expect(itemNames(dialog)).toEqual(['Dashboard', 'Service Accounts', 'Feature Flags', 'Settings', 'Get help']);
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

  it('lists Feature Flags and goes to /feature-flags (R14)', async () => {
    const user = userEvent.setup();
    const { router, sidebar } = await renderShell('/');
    const dialog = await openFromSearch(user, sidebar);
    await user.keyboard('flag');
    expect(itemNames(dialog)).toEqual(['Feature Flags']);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Feature flags' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/feature-flags');
  });

  it('closes on Escape and returns focus to the Search button', async () => {
    const user = userEvent.setup();
    const { sidebar } = await renderShell('/');
    await openFromSearch(user, sidebar);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(within(sidebar).getByRole('button', { name: 'Search' })).toHaveFocus());
  });

  it('closes on a press outside it and returns focus to the Search button', async () => {
    const user = userEvent.setup();
    const { sidebar } = await renderShell('/');
    const dialog = await openFromSearch(user, sidebar);
    const overlay = dialog.closest('[class*="overlay"]');
    if (!(overlay instanceof HTMLElement)) throw new Error('the palette has no overlay');
    await user.click(overlay);
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

describe('the palette and the mobile panel never stack (KTD7)', () => {
  it('closes the open panel before Ctrl+K opens the palette, and Escape then returns focus to the toggle', async () => {
    const user = userEvent.setup();
    const { toggle } = await renderMobileShell('/');
    await user.click(toggle);
    await screen.findByRole('dialog', { name: 'Navigation' });
    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Search' });
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
    await waitFor(() => expect(within(palette).getByRole('searchbox')).toHaveFocus());
    expect(palette.closest('[aria-hidden="true"], [inert]')).toBeNull();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it('does not open the panel over the open palette with Ctrl+B', async () => {
    const user = userEvent.setup();
    await renderMobileShell('/');
    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('dialog', { name: 'Search' });
    await user.keyboard('{Control>}b{/Control}');
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument();
  });

  it('ignores Ctrl+B while the palette is queued behind a closing mobile panel (line 77)', async () => {
    const user = userEvent.setup();
    const { toggle } = await renderMobileShell('/');
    await user.click(toggle);
    await screen.findByRole('dialog', { name: 'Navigation' });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
    });

    expect(await screen.findByRole('dialog', { name: 'Search' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
  });

  it('ignores unknown menu action keys without closing or navigating (line 42)', async () => {
    let capturedOnAction: ((key: string | number) => void) | undefined;
    const navigate = vi.fn<() => void>();
    vi.resetModules();
    vi.doMock('@tanstack/react-router', () => ({
      useRouter: () => ({ navigate }),
    }));
    vi.doMock('react-aria-components', () => ({
      ModalOverlay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      Autocomplete: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      SearchField: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      Input: () => <input />,
      Menu: ({ onAction }: { onAction?: (key: string | number) => void }) => {
        capturedOnAction = onAction;
        return <div />;
      },
      MenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      useFilter: () => ({ contains: () => true }),
    }));
    const { CommandPalette } = await import('./command-palette');
    const onOpenChange = vi.fn<(isOpen: boolean) => void>();
    render(<CommandPalette isOpen={true} onOpenChange={onOpenChange} />);
    capturedOnAction?.('/unknown');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    vi.doUnmock('@tanstack/react-router');
    vi.doUnmock('react-aria-components');
    vi.resetModules();
  });
});
