import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SdgHeader } from './sdg-header.js';
import { activeIn, mount, shadow } from './test-support/mount.js';

const user = { name: 'Ada Lovelace', email: 'ada@example.com' };
const triggerName = 'Account menu for Ada Lovelace';

const trigger = (element: SdgHeader) => shadow(element).getByRole('button', { name: triggerName });

async function openWithPointer(element: SdgHeader) {
  await userEvent.click(trigger(element));
  await element.updateComplete;
  return shadow(element).getByRole('menu', { name: triggerName });
}

describe('<sdg-header> account menu (wide)', () => {
  describe('trigger', () => {
    it('labels the trigger "Account menu for <name>" with aria-haspopup="menu" and aria-expanded', async () => {
      const element = await mount({ user });
      expect(trigger(element).getAttribute('aria-haspopup')).toBe('menu');
      expect(trigger(element).getAttribute('aria-expanded')).toBe('false');
      await openWithPointer(element);
      expect(trigger(element).getAttribute('aria-expanded')).toBe('true');
      expect(trigger(element).getAttribute('aria-controls')).toBe('account-menu');
    });

    it('shows the user initials, or the avatar image, falling back to initials when the image fails', async () => {
      const element = await mount({ user: { ...user, avatarSrc: '/ada.png' } });
      const image = trigger(element).querySelector('img');
      expect(image?.getAttribute('src')).toBe('/ada.png');
      expect(image?.getAttribute('alt')).toBe('');

      image?.dispatchEvent(new Event('error'));
      await element.updateComplete;
      expect(trigger(element).querySelector('img')).toBeNull();
      expect(trigger(element).textContent?.trim()).toBe('AL');
    });
  });

  describe('menu', () => {
    it('opens a role="menu" with the profile name and email', async () => {
      const element = await mount({ user, signOutFn: vi.fn<() => void>() });
      expect(shadow(element).queryByRole('menu')).toBeNull();
      const menu = await openWithPointer(element);
      expect(menu.textContent).toContain('Ada Lovelace');
      expect(menu.textContent).toContain('ada@example.com');
      expect(menu.querySelector('.profile')?.getAttribute('role')).toBe('none');
    });

    it('lists Log out as a menuitem only when signOutFn is set', async () => {
      const withSignOut = await mount({ user, signOutFn: vi.fn<() => void>() });
      const menu = await openWithPointer(withSignOut);
      const logout = shadow(withSignOut).getByRole('menuitem', { name: 'Log out' });
      expect(menu.contains(logout)).toBe(true);
      expect(logout.querySelector('svg[data-icon="right-from-bracket"]')).not.toBeNull();
      document.body.replaceChildren();

      const withoutSignOut = await mount({ user });
      await openWithPointer(withoutSignOut);
      expect(shadow(withoutSignOut).queryAllByRole('menuitem')).toHaveLength(0);
    });

    it('calls signOutFn and closes when Log out is activated', async () => {
      const signOutFn = vi.fn<() => void>();
      const element = await mount({ user, signOutFn });
      await openWithPointer(element);
      await userEvent.click(shadow(element).getByRole('menuitem', { name: 'Log out' }));
      await element.updateComplete;
      expect(signOutFn).toHaveBeenCalledOnce();
      expect(shadow(element).queryByRole('menu')).toBeNull();
      expect(trigger(element).getAttribute('aria-expanded')).toBe('false');
    });
  });

  describe('keyboard', () => {
    it.each([
      ['Enter', '{Enter}'],
      ['Space', ' '],
      ['ArrowDown', '{ArrowDown}'],
    ])('focuses the first item when opened with %s', async (_name, key) => {
      const element = await mount({ user, signOutFn: vi.fn<() => void>() });
      trigger(element).focus();
      await userEvent.keyboard(key);
      await element.updateComplete;
      expect(shadow(element).getByRole('menu')).toBeTruthy();
      expect(activeIn(element)).toBe(shadow(element).getByRole('menuitem', { name: 'Log out' }));
    });

    it('focuses the last item when opened with ArrowUp', async () => {
      const element = await mount({ user, signOutFn: vi.fn<() => void>() });
      trigger(element).focus();
      await userEvent.keyboard('{ArrowUp}');
      await element.updateComplete;
      expect(activeIn(element)).toBe(shadow(element).getByRole('menuitem', { name: 'Log out' }));
      // One item: Home, End and the arrows all stay on it.
      await userEvent.keyboard('{ArrowDown}{Home}{End}');
      expect(activeIn(element)?.getAttribute('role')).toBe('menuitem');
    });

    it('closes on Escape and returns focus to the trigger', async () => {
      const element = await mount({ user, signOutFn: vi.fn<() => void>() });
      trigger(element).focus();
      await userEvent.keyboard('{Enter}');
      await element.updateComplete;
      expect(shadow(element).getByRole('menu')).toBeTruthy();
      await userEvent.keyboard('{Escape}');
      await element.updateComplete;
      expect(shadow(element).queryByRole('menu')).toBeNull();
      expect(activeIn(element)).toBe(trigger(element));
    });

    it('closes on Tab', async () => {
      const element = await mount({ user, signOutFn: vi.fn<() => void>() });
      trigger(element).focus();
      await userEvent.keyboard('{Enter}');
      await element.updateComplete;
      await userEvent.tab();
      await element.updateComplete;
      expect(shadow(element).queryByRole('menu')).toBeNull();
      expect(trigger(element).getAttribute('aria-expanded')).toBe('false');
    });
  });

  describe('pointer', () => {
    it('focuses the menu container (no highlighted item) when opened by pointer', async () => {
      const element = await mount({ user, signOutFn: vi.fn<() => void>() });
      const menu = await openWithPointer(element);
      expect(activeIn(element)).toBe(menu);
      expect(activeIn(element)?.getAttribute('role')).not.toBe('menuitem');
    });

    it('closes on a pointer press outside', async () => {
      const element = await mount({ user, signOutFn: vi.fn<() => void>() });
      const outside = document.createElement('p');
      outside.textContent = 'Page content';
      document.body.append(outside);
      await openWithPointer(element);

      await userEvent.click(outside);
      await element.updateComplete;
      expect(shadow(element).queryByRole('menu')).toBeNull();
      expect(trigger(element).getAttribute('aria-expanded')).toBe('false');
    });
  });
});
