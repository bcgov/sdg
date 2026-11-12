import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeConsoleApi } from '../../test-support/fake-console-api';
import { renderAt } from '../../test-support/render';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

/** Renders a signed-in page and waits for the shell; the sidebar is the element the toggle controls. */
async function renderShell(path: string) {
  fakeConsoleApi();
  const rendered = renderAt(path);
  const toggle = await screen.findByRole('button', { name: /sidebar$/ });
  const sidebar = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
  if (!sidebar) throw new Error('the toggle controls no element');
  return { ...rendered, toggle, sidebar };
}

type User = ReturnType<typeof userEvent.setup>;

/** Presses Tab until the element has focus, at most `pressesLeft` times. */
async function pressTabUntil(user: User, element: HTMLElement, pressesLeft: number): Promise<void> {
  if (document.activeElement === element || pressesLeft === 0) return;
  await user.tab();
  return pressTabUntil(user, element, pressesLeft - 1);
}

/** Tabs to an element, so react-aria sees keyboard focus (tooltips open only on visible focus). */
async function tabTo(user: User, element: HTMLElement) {
  await pressTabUntil(user, element, 20);
  expect(element).toHaveFocus();
}

const linkNames = (nav: HTMLElement) =>
  within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent);

const blocked = () => {
  throw new DOMException('The operation is insecure.', 'SecurityError');
};

const precedes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('the sidebar (R6, R7, R9, R10)', () => {
  it('shows the SDG link, Search, the Main nav and the Secondary nav, in that order', async () => {
    const { sidebar } = await renderShell('/');
    const brand = within(sidebar).getByRole('link', { name: 'SDG' });
    const search = within(sidebar).getByRole('button', { name: 'Search' });
    const mainNav = within(sidebar).getByRole('navigation', { name: 'Main' });
    const secondaryNav = within(sidebar).getByRole('navigation', { name: 'Secondary' });

    expect(brand).toHaveAttribute('href', '/');
    expect(brand.querySelector('img')).toHaveAttribute('alt', '');
    expect(linkNames(mainNav)).toEqual(['Dashboard', 'Service Accounts']);
    expect(linkNames(secondaryNav)).toEqual(['Settings', 'Get help']);
    expect(precedes(brand, search) && precedes(search, mainNav) && precedes(mainNav, secondaryNav)).toBe(true);
  });

  it('marks the current page: on /service-clients, Service Accounts and not Dashboard', async () => {
    const { sidebar } = await renderShell('/service-clients');
    expect(within(sidebar).getByRole('link', { name: 'Service Accounts' })).toHaveAttribute('aria-current', 'page');
    expect(within(sidebar).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('navigates client-side: the route changes and the same shell stays mounted', async () => {
    const user = userEvent.setup();
    const { router, sidebar } = await renderShell('/');
    await user.click(within(sidebar).getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings');
    expect(sidebar).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });

  it('moves focus to main#main-content from the skip link', async () => {
    const user = userEvent.setup();
    await renderShell('/');
    await user.click(screen.getByRole('link', { name: 'Skip to main content' }));
    expect(screen.getByRole('main')).toHaveFocus();
  });
});

describe('the icon rail (R12, AE4)', () => {
  it('collapses from the toggle, keeps link names, and shows a tooltip on focus only while collapsed', async () => {
    const user = userEvent.setup();
    const { toggle, sidebar } = await renderShell('/');
    const link = within(sidebar).getByRole('link', { name: 'Service Accounts' });
    expect(toggle).toHaveAccessibleName('Collapse sidebar');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await tabTo(user, link);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(sidebar).toHaveAttribute('data-state', 'collapsed');
    expect(toggle).toHaveAccessibleName('Expand sidebar');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(link).toHaveAccessibleName('Service Accounts');
    await tabTo(user, link);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Service Accounts');
  });

  it('keeps the Search name when collapsed, drops its shortcut hint, and labels it with a tooltip', async () => {
    const user = userEvent.setup();
    const { toggle, sidebar } = await renderShell('/');
    const search = within(sidebar).getByRole('button', { name: 'Search' });
    expect(search.querySelector('kbd')).not.toBeNull();

    await user.click(toggle);
    expect(search).toHaveAccessibleName('Search');
    expect(search.querySelector('kbd')).toBeNull();
    await tabTo(user, search);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Search');
  });

  it('toggles with Ctrl+B and is still collapsed after a reload', async () => {
    const user = userEvent.setup();
    const first = await renderShell('/');
    await user.keyboard('{Control>}b{/Control}');
    expect(first.sidebar).toHaveAttribute('data-state', 'collapsed');
    await user.keyboard('{Control>}b{/Control}');
    expect(first.sidebar).toHaveAttribute('data-state', 'expanded');
    await user.keyboard('{Control>}b{/Control}');

    cleanup();
    const reloaded = await renderShell('/');
    expect(reloaded.sidebar).toHaveAttribute('data-state', 'collapsed');
  });

  it('renders expanded and still toggles when localStorage throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    const user = userEvent.setup();
    const { toggle, sidebar } = await renderShell('/');
    expect(sidebar).toHaveAttribute('data-state', 'expanded');
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    await user.click(toggle);
    expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  });
});
