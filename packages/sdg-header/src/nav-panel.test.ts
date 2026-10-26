import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SdgHeader } from './sdg-header.js';
import { activeIn, mount, shadow, stubMatchMedia } from './test-support/mount.js';

const navItems = [
  { label: 'Home', href: '/' },
  { label: 'Help', href: '/help' },
];
const user = { name: 'Ada Lovelace', email: 'ada@example.com' };

const toggle = (element: SdgHeader) => shadow(element).getByRole('button', { name: 'Menu' });
const panel = (element: SdgHeader) => element.shadowRoot!.querySelector<HTMLElement>('#nav-panel');
/** The panel's sections, top to bottom. */
const sections = (opened: HTMLElement) => Array.from(opened.children, (child) => child.className);
const logoLink = (element: SdgHeader) => shadow(element).getByTitle('Government of British Columbia');

async function open(element: SdgHeader) {
  await userEvent.click(toggle(element));
  await element.updateComplete;
  const opened = panel(element);
  if (!opened) throw new Error('panel did not open');
  return opened;
}

describe('<sdg-header> collapsed layout (narrow)', () => {
  describe('logo', () => {
    it('swaps the full logo for the emblem below 768px, keeping the link, divider and title', async () => {
      stubMatchMedia(true);
      const element = await mount({ navItems }, { 'logo-href': '/portal' });
      const link = logoLink(element);
      expect(link.getAttribute('href')).toBe('/portal');
      expect(link.querySelector('svg#bcgov-emblem-header path')).not.toBeNull();
      expect(link.querySelector('svg#bcgov-logo-header')).toBeNull();
      expect(element.shadowRoot!.querySelector('.bcds-header--line')).not.toBeNull();
      expect(shadow(element).getByText('SDG').classList.contains('bcds-header--title')).toBe(true);
    });

    it('shows the emblem even with no nav items or account control', async () => {
      stubMatchMedia(true);
      const element = await mount();
      expect(logoLink(element).querySelector('svg#bcgov-emblem-header')).not.toBeNull();
    });

    it('restores the full logo when the screen widens', async () => {
      const media = stubMatchMedia(true);
      const element = await mount({ navItems });
      expect(logoLink(element).querySelector('svg#bcgov-emblem-header')).not.toBeNull();
      media.set(false);
      await element.updateComplete;
      expect(logoLink(element).querySelector('svg#bcgov-logo-header path')).not.toBeNull();
      expect(logoLink(element).querySelector('svg#bcgov-emblem-header')).toBeNull();
    });
  });

  describe('toggle', () => {
    it('shows only the hamburger (aria-label menu-label, aria-expanded, aria-controls) below 768px', async () => {
      stubMatchMedia(true);
      const element = await mount({ navItems, signInHref: '/login' }, { 'menu-label': 'Site menu' });
      const button = shadow(element).getByRole('button', { name: 'Site menu' });
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(button.getAttribute('aria-controls')).toBe('nav-panel');
      expect(button.querySelector('svg[data-icon="bars"]')).not.toBeNull();
      expect(shadow(element).queryByRole('navigation')).toBeNull();
      expect(shadow(element).queryByRole('link', { name: 'Sign in' })).toBeNull();
    });

    it('stays wide when matchMedia is unavailable', async () => {
      vi.stubGlobal('matchMedia', undefined);
      const element = await mount({ navItems, signInHref: '/login' });
      expect(shadow(element).queryByRole('button', { name: 'Menu' })).toBeNull();
      expect(shadow(element).getByRole('navigation', { name: 'Main' })).toBeTruthy();
      expect(shadow(element).getByRole('link', { name: 'Sign in' })).toBeTruthy();
    });
  });

  describe('panel', () => {
    it('lists nav items then Sign in when signed out', async () => {
      stubMatchMedia(true);
      const element = await mount({ navItems, signInHref: '/login' });
      const opened = await open(element);
      const links = Array.from(opened.querySelectorAll('a')).map((link) => link.textContent?.trim());
      expect(links).toEqual(['Home', 'Help', 'Sign in']);
      expect(opened.querySelector('nav')?.getAttribute('aria-label')).toBe('Main');
      expect(toggle(element).querySelector('svg[data-icon="xmark"]')).not.toBeNull();
    });

    it('shows the profile and a Log out button when signed in with signOutFn', async () => {
      stubMatchMedia(true);
      const signOutFn = vi.fn<() => void>();
      const element = await mount({ navItems, user, signOutFn });
      const opened = await open(element);
      expect(opened.querySelector('.name')?.textContent).toBe('Ada Lovelace');
      expect(opened.querySelector('.email')?.textContent).toBe('ada@example.com');
      await userEvent.click(shadow(element).getByRole('button', { name: 'Log out' }));
      expect(signOutFn).toHaveBeenCalledOnce();
    });

    it('omits Log out when signOutFn is unset', async () => {
      stubMatchMedia(true);
      const element = await mount({ user });
      const opened = await open(element);
      expect(opened.querySelector('.name')?.textContent).toBe('Ada Lovelace');
      expect(shadow(element).queryByRole('button', { name: 'Log out' })).toBeNull();
    });

    it('is only in the DOM while open', async () => {
      stubMatchMedia(true);
      const element = await mount({ navItems });
      expect(panel(element)).toBeNull();
      await open(element);
      expect(panel(element)).not.toBeNull();
      await userEvent.click(toggle(element));
      await element.updateComplete;
      expect(panel(element)).toBeNull();
    });
  });

  describe('panel layout', () => {
    it('stacks the profile card, the nav items, then a footer with Log out when signed in', async () => {
      stubMatchMedia(true);
      const element = await mount({ navItems, user, signOutFn: vi.fn<() => void>() });
      const opened = await open(element);
      expect(sections(opened)).toEqual(['panel-profile', 'panel-items', 'panel-footer']);
      expect(opened.querySelector('.panel-profile .name')?.textContent).toBe('Ada Lovelace');
      expect(opened.querySelector('.panel-items nav')?.getAttribute('aria-label')).toBe('Main');
      expect(opened.querySelector('.panel-footer button')?.textContent?.trim()).toBe('Log out');
    });

    it('has no profile card and puts Sign in in the footer when signed out', async () => {
      stubMatchMedia(true);
      const element = await mount({ navItems, signInHref: '/login' });
      const opened = await open(element);
      expect(sections(opened)).toEqual(['panel-items', 'panel-footer']);
      expect(opened.querySelector('.panel-footer a')?.getAttribute('href')).toBe('/login');
      expect(opened.querySelector('.panel-items a[href="/login"]')).toBeNull();
    });

    it('has no footer when signed in without signOutFn', async () => {
      stubMatchMedia(true);
      const element = await mount({ navItems, user });
      expect(sections(await open(element))).toEqual(['panel-profile', 'panel-items']);
    });

    it('keeps the (empty) items region with no nav items, so the footer stays at the bottom', async () => {
      stubMatchMedia(true);
      const element = await mount({ user, signOutFn: vi.fn<() => void>() });
      const opened = await open(element);
      expect(sections(opened)).toEqual(['panel-profile', 'panel-items', 'panel-footer']);
      expect(opened.querySelector('.panel-items')?.children).toHaveLength(0);
    });
  });

  describe('closing', () => {
    it('closes on Escape and returns focus to the toggle', async () => {
      stubMatchMedia(true);
      const element = await mount({ navItems });
      const opened = await open(element);
      opened.querySelector('a')?.focus();
      await userEvent.keyboard('{Escape}');
      await element.updateComplete;
      expect(panel(element)).toBeNull();
      expect(activeIn(element)).toBe(toggle(element));
    });

    it('closes when a link or button in the panel is activated', async () => {
      stubMatchMedia(true);
      const navigateFn = vi.fn<(href: string) => void>();
      const element = await mount({ navItems, navigateFn });
      await open(element);
      await userEvent.click(shadow(element).getByRole('link', { name: 'Help' }));
      await element.updateComplete;
      expect(navigateFn).toHaveBeenCalledWith('/help');
      expect(panel(element)).toBeNull();
      expect(toggle(element).getAttribute('aria-expanded')).toBe('false');
    });

    it('closes on a pointer press outside the element', async () => {
      stubMatchMedia(true);
      const element = await mount({ navItems });
      const outside = document.createElement('p');
      document.body.append(outside);
      await open(element);
      await userEvent.click(outside);
      await element.updateComplete;
      expect(panel(element)).toBeNull();
    });

    it('switches to the wide layout when the query stops matching', async () => {
      const media = stubMatchMedia(true);
      const element = await mount({ navItems, signInHref: '/login' });
      await open(element);

      media.set(false);
      await element.updateComplete;
      expect(shadow(element).queryByRole('button', { name: 'Menu' })).toBeNull();
      expect(shadow(element).getByRole('link', { name: 'Sign in' })).toBeTruthy();

      media.set(true);
      await element.updateComplete;
      expect(toggle(element).getAttribute('aria-expanded')).toBe('false');
      expect(panel(element)).toBeNull();
    });
  });
});
