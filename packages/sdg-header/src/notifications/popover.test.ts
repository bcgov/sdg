import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SdgHeader } from '../sdg-header.js';
import { inboxItem, notificationsUrl, stubInbox, type InboxBackend } from '../test-support/inbox-backend.js';
import { activeIn, mount, shadow, stubMatchMedia } from '../test-support/mount.js';
import { popoverStyles } from './styles.js';

const user = { name: 'Ada Lovelace' };

/** Lets the source's fetches and the element's re-render finish (real timers). */
async function settle(element: SdgHeader): Promise<void> {
  await vi.waitFor(() => expect(element.shadowRoot!.querySelector('.notifications')).not.toBeNull());
  await new Promise((resolve) => setTimeout(resolve, 10));
  await element.updateComplete;
}

async function setup(api: InboxBackend, inputs: Parameters<typeof mount>[0] = {}) {
  const navigateFn = vi.fn<(href: string) => void>();
  const element = await mount({ user, notificationsUrl, inboxHref: '/inbox', navigateFn, ...inputs });
  await settle(element);
  return { element, navigateFn, api };
}

const bell = (element: SdgHeader) => shadow(element).getByRole('button', { name: /^Notifications/u });
const dialog = (element: SdgHeader) => shadow(element).queryByRole('dialog', { name: 'Notifications' });
const rows = (element: SdgHeader) =>
  Array.from(element.shadowRoot!.querySelectorAll<HTMLElement>('.notification-item'));
const markAll = (element: SdgHeader) => shadow(element).getByRole('button', { name: 'Mark all as read' });

async function open(element: SdgHeader): Promise<HTMLElement> {
  await userEvent.click(bell(element));
  await element.updateComplete;
  const opened = dialog(element);
  if (!opened) throw new Error('popover did not open');
  return opened;
}

describe('<sdg-header> notifications popover', () => {
  describe('opening and closing (R3, R8)', () => {
    it('opens a labelled dialog from the bell, with focus on the first item', async () => {
      const { element } = await setup(stubInbox([inboxItem(1), inboxItem(2)]));
      expect(bell(element).getAttribute('aria-haspopup')).toBe('dialog');
      expect(bell(element).getAttribute('aria-expanded')).toBe('false');
      expect(dialog(element)).toBeNull();

      await open(element);
      expect(bell(element).getAttribute('aria-expanded')).toBe('true');
      expect(bell(element).getAttribute('aria-controls')).toBe('notifications-panel');
      expect(element.shadowRoot!.querySelector('#notifications-panel')?.getAttribute('role')).toBe('dialog');
      expect(activeIn(element)).toBe(rows(element)[0]);
    });

    it('closes on Escape and returns focus to the bell', async () => {
      const { element } = await setup(stubInbox([inboxItem(1)]));
      await open(element);
      await userEvent.keyboard('{Escape}');
      await element.updateComplete;
      expect(dialog(element)).toBeNull();
      expect(activeIn(element)).toBe(bell(element));
    });

    it('closes on a click outside the header, and stays open for a click inside the panel', async () => {
      const { element } = await setup(stubInbox([inboxItem(1)]));
      const outside = document.createElement('p');
      outside.textContent = 'Page content';
      document.body.append(outside);
      const panel = await open(element);

      await userEvent.click(panel.querySelector('h2')!);
      await element.updateComplete;
      expect(dialog(element)).not.toBeNull();

      await userEvent.click(outside);
      await element.updateComplete;
      expect(dialog(element)).toBeNull();
      expect(bell(element).getAttribute('aria-expanded')).toBe('false');
    });
  });

  describe('rows (R4, R5)', () => {
    it('lists items newest first with title, excerpt and age, marking only unread ones', async () => {
      const read = inboxItem(2, { readAt: '2026-11-05T16:00:00.000Z' }, 60 * 3);
      const { element } = await setup(stubInbox([inboxItem(1), read]));
      await open(element);
      const [unreadRow, readRow] = rows(element);
      expect(unreadRow?.textContent).toContain('Notification 1');
      expect(unreadRow?.textContent).toContain('Excerpt 1');
      expect(unreadRow?.textContent).toContain('5 minutes ago');
      expect(unreadRow?.querySelector('.unread-dot')).not.toBeNull();
      expect(unreadRow?.querySelector('.visually-hidden')?.textContent).toBe('Unread');
      expect(readRow?.textContent).toContain('3 hours ago');
      expect(readRow?.querySelector('.unread-dot')).toBeNull();
      expect(readRow?.textContent).not.toContain('Unread');
    });

    it('falls back to "Notification" for an item without a title', async () => {
      const { element } = await setup(stubInbox([inboxItem(1, { title: null, excerpt: null })]));
      await open(element);
      expect(rows(element)[0]?.querySelector('.item-title')?.textContent).toBe('Notification');
    });

    it('marks an activated item read, closes the popover and navigates to its page under inbox-href', async () => {
      const { element, navigateFn, api } = await setup(stubInbox([inboxItem(1), inboxItem(2)]));
      await open(element);
      await userEvent.click(rows(element)[1]!);
      await element.updateComplete;
      expect(navigateFn).toHaveBeenCalledWith('/inbox/notification-2');
      expect(dialog(element)).toBeNull();
      expect(api.requests.find(({ path }) => path === 'inbox/item-2/read')).toMatchObject({ method: 'POST' });
      await vi.waitFor(() => expect(bell(element).getAttribute('aria-label')).toBe('Notifications, 1 unread'));
    });

    it('adds a row arriving while open at the top without moving focus', async () => {
      const api = stubInbox([inboxItem(1), inboxItem(2)]);
      const { element } = await setup(api);
      await open(element);
      rows(element)[1]!.focus();
      api.state.items = [inboxItem(3, {}, 0), ...api.state.items];
      api.changed();
      await vi.waitFor(() => expect(rows(element)).toHaveLength(3));
      expect(rows(element)[0]?.textContent).toContain('Notification 3');
      expect(activeIn(element)?.textContent).toContain('Notification 2');
    });
  });

  describe('mark all as read (R6, F4)', () => {
    it('is aria-disabled, but focusable, when nothing is unread', async () => {
      const { element } = await setup(stubInbox([inboxItem(1, { readAt: '2026-11-05T16:00:00.000Z' })]));
      await open(element);
      expect(markAll(element).getAttribute('aria-disabled')).toBe('true');
      expect(markAll(element).hasAttribute('disabled')).toBe(false);
    });

    it('marks everything read, hides the badge and moves focus to the first item', async () => {
      const { element, api } = await setup(stubInbox([inboxItem(1), inboxItem(2)]));
      await open(element);
      expect(markAll(element).getAttribute('aria-disabled')).toBe('false');
      await userEvent.click(markAll(element));
      await vi.waitFor(() => expect(element.shadowRoot!.querySelector('.badge')).toBeNull());
      expect(api.count('inbox/read-all')).toBe(1);
      expect(markAll(element).getAttribute('aria-disabled')).toBe('true');
      expect(activeIn(element)).toBe(rows(element)[0]);
      expect(rows(element).every((row) => row.querySelector('.unread-dot') === null)).toBe(true);
    });

    it('shows an inline error, announces it and keeps the count when mark-all fails', async () => {
      const api = stubInbox([inboxItem(1), inboxItem(2)]);
      api.state.answers.set('inbox/read-all', 500);
      const { element } = await setup(api);
      await open(element);
      await userEvent.click(markAll(element));
      await vi.waitFor(() =>
        expect(element.shadowRoot!.querySelector('.inline-error')?.textContent).toBe("Couldn't mark all as read."),
      );
      expect(markAll(element).getAttribute('aria-describedby')).toBe('mark-all-error');
      expect(element.shadowRoot!.querySelector('.badge')?.textContent?.trim()).toBe('2');
      expect(markAll(element).getAttribute('aria-disabled')).toBe('false');
      expect(element.shadowRoot!.querySelector('[aria-live="polite"]')?.textContent).toContain(
        "Couldn't mark all as read.",
      );
    });
  });

  describe('states and links (R7, R9)', () => {
    it('shows an empty state, focused on open', async () => {
      const { element } = await setup(stubInbox([]));
      await open(element);
      expect(activeIn(element)?.textContent).toBe('No notifications yet');
    });

    it('shows a load failure with a retry that refetches', async () => {
      const api = stubInbox([inboxItem(1)]);
      api.state.answers.set('inbox/unread-count', 500);
      const { element } = await setup(api);
      await open(element);
      expect(shadow(element).getByText("Couldn't load notifications.")).toBeTruthy();
      api.state.answers.clear();
      await userEvent.click(shadow(element).getByRole('button', { name: 'Try again' }));
      await vi.waitFor(() => expect(rows(element)).toHaveLength(1));
      // The retry is a user action: it carries no background marker.
      const userLoads = api.requests.filter(
        ({ path, headers }) => path === 'inbox/unread-count' && !headers['sdg-background'],
      );
      expect(userLoads).toHaveLength(1);
    });

    it('links "View all" to inbox-href through navigateFn, and closes', async () => {
      const { element, navigateFn } = await setup(stubInbox([inboxItem(1)]), { inboxHref: '/messages' });
      await open(element);
      const viewAll = shadow(element).getByRole('link', { name: 'View all' });
      expect(viewAll.getAttribute('href')).toBe('/messages');
      await userEvent.click(viewAll);
      await element.updateComplete;
      expect(navigateFn).toHaveBeenCalledWith('/messages');
      expect(dialog(element)).toBeNull();
    });
  });

  describe('narrow screens', () => {
    it('opens the panel in the bar, held inside the viewport less the page gutter', async () => {
      stubMatchMedia(true);
      const { element } = await setup(stubInbox([inboxItem(1)]));
      const panel = await open(element);
      expect(panel.closest('.bar-actions')).not.toBeNull();
      expect(panel.closest('#nav-panel')).toBeNull();
      // jsdom has no layout: check the collapsed rule that anchors the panel to the header's gutters.
      expect(panel.closest('.notifications')?.classList.contains('collapsed')).toBe(true);
      expect(popoverStyles.cssText.replaceAll(/\s+/gu, ' ')).toContain(
        '.notifications.collapsed .notifications-panel { right: var(--layout-padding-medium, 1rem); max-width: calc(100% - 2 * var(--layout-padding-medium, 1rem));',
      );
    });
  });
});
