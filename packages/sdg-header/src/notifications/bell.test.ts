import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SdgHeader } from '../sdg-header.js';
import { inboxItem, notificationsUrl, stubInbox } from '../test-support/inbox-backend.js';
import { mount, shadow, stubMatchMedia } from '../test-support/mount.js';

const user = { name: 'Ada Lovelace' };

/** Lets the source's fetches and the element's re-render finish. */
async function settle(element: SdgHeader): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await element.updateComplete;
}

async function mountSignedIn(inputs: Parameters<typeof mount>[0] = {}): Promise<SdgHeader> {
  const element = await mount({ user, notificationsUrl, ...inputs });
  await settle(element);
  return element;
}

const bell = (element: SdgHeader) => shadow(element).queryByRole('button', { name: /^Notifications/u });
const badge = (element: SdgHeader) => element.shadowRoot!.querySelector('.badge');
const liveRegion = (element: SdgHeader) => element.shadowRoot!.querySelector('[aria-live="polite"]');

afterEach(() => {
  vi.useRealTimers();
});

describe('<sdg-header> notifications bell', () => {
  describe('visibility (R1, AE1)', () => {
    it('renders no bell and makes no requests without notifications-url', async () => {
      vi.useFakeTimers();
      const api = stubInbox([inboxItem(1)]);
      const element = await mount({ user });
      await settle(element);
      expect(bell(element)).toBeNull();
      expect(api.requests).toHaveLength(0);
      expect(element.shadowRoot!.querySelector('.nav-area')?.children).toHaveLength(1);
    });

    it('renders no bell while signed out, even with notifications-url', async () => {
      vi.useFakeTimers();
      const api = stubInbox([inboxItem(1)]);
      const element = await mount({ notificationsUrl, signInHref: '/login' });
      await settle(element);
      expect(bell(element)).toBeNull();
      expect(api.requests).toHaveLength(0);
    });

    it('reads notifications-url and inbox-href as attributes', async () => {
      vi.useFakeTimers();
      stubInbox([inboxItem(1)]);
      const element = await mount({ user }, { 'notifications-url': notificationsUrl, 'inbox-href': '/messages' });
      await settle(element);
      expect(element.notificationsUrl).toBe(notificationsUrl);
      expect(element.inboxHref).toBe('/messages');
      expect(bell(element)).not.toBeNull();

      element.removeAttribute('inbox-href');
      await element.updateComplete;
      expect(element.inboxHref).toBe('/inbox');
    });

    it('puts the bell before the account control on wide screens', async () => {
      vi.useFakeTimers();
      stubInbox([inboxItem(1)]);
      const element = await mountSignedIn();
      const area = element.shadowRoot!.querySelector('.nav-area')!;
      expect(Array.from(area.children, (child) => child.className)).toEqual(['notifications', 'account-menu']);
    });

    it('hides the bell when the source answers 404', async () => {
      vi.useFakeTimers();
      const api = stubInbox([inboxItem(1)]);
      api.state.answers.set('inbox/unread-count', 404);
      const element = await mountSignedIn();
      expect(bell(element)).toBeNull();
    });
  });

  describe('badge (R2, AE2)', () => {
    it.each([
      [0, null, 'Notifications, 0 unread'],
      [7, '7', 'Notifications, 7 unread'],
      [140, '99+', 'Notifications, 140 unread'],
    ])('shows %i unread as %s with the real count in the accessible name', async (unread, text, name) => {
      vi.useFakeTimers();
      stubInbox([inboxItem(1)], unread);
      const element = await mountSignedIn();
      expect(bell(element)?.getAttribute('aria-label')).toBe(name);
      expect(badge(element)?.textContent?.trim() ?? null).toBe(text);
      expect(badge(element)?.getAttribute('aria-hidden') ?? 'true').toBe('true');
    });
  });

  describe('announcements (R25, KTD13)', () => {
    it('stays silent on first load, then announces a later count change once', async () => {
      vi.useFakeTimers();
      const api = stubInbox([inboxItem(1), inboxItem(2)]);
      const element = await mountSignedIn();
      await vi.advanceTimersByTimeAsync(5_000);
      await element.updateComplete;
      expect(liveRegion(element)?.textContent?.trim()).toBe('');

      api.state.items = [inboxItem(3), ...api.state.items];
      api.state.unread = 3;
      api.changed();
      await vi.advanceTimersByTimeAsync(300);
      await element.updateComplete;
      expect(badge(element)?.textContent?.trim()).toBe('3');
      // A second change within the window is folded into one announcement of the latest count.
      api.state.unread = 4;
      api.changed();
      await vi.advanceTimersByTimeAsync(5_000);
      await element.updateComplete;
      expect(liveRegion(element)?.textContent?.trim()).toBe('4 unread notifications');
      expect(liveRegion(element)?.getAttribute('aria-live')).toBe('polite');
    });
  });

  describe('narrow screens', () => {
    it('renders the bell in the bar beside the menu button, not inside the nav panel', async () => {
      vi.useFakeTimers();
      stubMatchMedia(true);
      stubInbox([inboxItem(1)]);
      const element = await mountSignedIn({ navItems: [{ label: 'Home', href: '/' }] });
      const button = bell(element);
      expect(button).not.toBeNull();
      expect(button?.closest('.panel')).toBeNull();
      const menuButton = shadow(element).getByRole('button', { name: 'Menu' });
      expect(button?.closest('.bar-actions')?.contains(menuButton)).toBe(true);

      menuButton.click();
      await element.updateComplete;
      expect(element.shadowRoot!.querySelector('#nav-panel')?.querySelector('.notifications')).toBeNull();
    });
  });
});
