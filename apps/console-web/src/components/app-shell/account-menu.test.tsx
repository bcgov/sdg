import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../auth/api';
import { ADMIN, fakeConsoleApi } from '../../test-support/fake-console-api';
import { renderShell, tabTo } from '../../test-support/shell';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const TRIGGER_NAME = `Account menu for ${ADMIN.name}`;

const precedes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/** Leaf elements with no text: an empty line where a missing email would have been. */
const emptyLeaves = (element: Element) =>
  Array.from(element.querySelectorAll('span, div')).filter((el) => el.children.length === 0 && !el.textContent);

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: TRIGGER_NAME }));
  return screen.findByRole('menu');
}

describe('the account menu (R11)', () => {
  it('names the trigger for the user and opens onto a profile block that is not a menu item', async () => {
    const user = userEvent.setup();
    const { sidebar } = await renderShell('/');
    const trigger = within(sidebar).getByRole('button', { name: TRIGGER_NAME });
    expect(trigger).toHaveTextContent(ADMIN.name);
    expect(trigger).toHaveTextContent(ADMIN.email);

    const menu = await openMenu(user);
    const profile = within(menu).getByText(ADMIN.email).closest('header');
    if (!profile) throw new Error('the email is not in the profile block');
    expect(profile).toHaveTextContent(ADMIN.name);
    expect(profile.closest('[role="menuitem"]')).toBeNull();
    const [firstItem] = within(menu).getAllByRole('menuitem');
    expect(precedes(profile, firstItem!)).toBe(true);
  });

  it('lists exactly Account settings then Log out, each after a separator', async () => {
    const user = userEvent.setup();
    await renderShell('/');
    const menu = await openMenu(user);
    const items = within(menu).getAllByRole('menuitem');
    const separators = within(menu).getAllByRole('separator');
    expect(items.map((item) => item.textContent)).toEqual(['Account settings', 'Log out']);
    expect(separators).toHaveLength(2);
    expect(precedes(separators[0]!, items[0]!) && precedes(items[0]!, separators[1]!)).toBe(true);
    expect(precedes(separators[1]!, items[1]!)).toBe(true);
  });

  it('goes to /account-settings client-side from Account settings and closes the menu', async () => {
    const user = userEvent.setup();
    const { router, sidebar } = await renderShell('/');
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Account settings' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Account settings' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/account-settings');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(sidebar).toBeInTheDocument();
  });

  it('logs out through console-api and goes to the redirectUrl it returns', async () => {
    const navigate = vi.fn<(url: string) => void>();
    const realLogout = api.logout;
    vi.spyOn(api, 'logout').mockImplementation((onSignedOut) => realLogout(onSignedOut, navigate));
    const consoleApi = fakeConsoleApi();
    const redirectUrl = 'https://loginproxy.example/logout?post_logout_redirect_uri=x';
    consoleApi.refuseNext('POST', '/api/auth/logout', () => Response.json({ redirectUrl }));
    const user = userEvent.setup();
    await renderShell('/', consoleApi);
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Log out' }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(redirectUrl));
    expect(consoleApi.callsTo('POST', '/api/auth/logout')).toHaveLength(1);
  });

  it('shows the name only, with no empty line, when the user has no email', async () => {
    const consoleApi = fakeConsoleApi();
    consoleApi.refuseNext('GET', '/api/auth/me', () => Response.json({ ...ADMIN, email: null }));
    const user = userEvent.setup();
    await renderShell('/', consoleApi);
    const trigger = screen.getByRole('button', { name: TRIGGER_NAME });
    expect(trigger).toHaveTextContent(ADMIN.name);
    expect(emptyLeaves(trigger)).toEqual([]);

    const menu = await openMenu(user);
    const profile = within(menu).getByText(ADMIN.name).closest('header');
    if (!profile) throw new Error('the name is not in the profile block');
    expect(emptyLeaves(profile)).toEqual([]);
    expect(menu).not.toHaveTextContent('@');
  });

  it('is keyboard-operable: Enter opens onto Account settings, arrows move, Escape closes back to the trigger', async () => {
    const user = userEvent.setup();
    await renderShell('/');
    const trigger = screen.getByRole('button', { name: TRIGGER_NAME });
    await tabTo(user, trigger);
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Account settings' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Log out' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('the account button on the icon rail (R12)', () => {
  it('shows only the avatar, keeps its name, and shows the user name as a tooltip on focus', async () => {
    const user = userEvent.setup();
    const { toggle } = await renderShell('/');
    await user.click(toggle);
    const trigger = screen.getByRole('button', { name: TRIGGER_NAME });
    expect(trigger).not.toHaveTextContent(ADMIN.name);
    expect(trigger).not.toHaveTextContent(ADMIN.email);
    expect(trigger.querySelector('[aria-hidden="true"]')).toHaveTextContent('AL');

    await tabTo(user, trigger);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(ADMIN.name);
  });
});
