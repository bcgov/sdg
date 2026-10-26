import { describe, expect, it, vi } from 'vitest';

import { SdgHeader } from './index.js';
import { mount, shadow } from './test-support/mount.js';

/** Dispatches a plain primary-button click and returns the event, to check whether it was prevented. */
function click(target: Element): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0 });
  target.dispatchEvent(event);
  return event;
}

const navItems = [
  { label: 'Home', href: '/' },
  { label: 'Help', href: '/help', current: true },
];

describe('<sdg-header>', () => {
  describe('shell', () => {
    it('renders exactly one banner <header class="bcds-header"> in its shadow root', async () => {
      const element = await mount();
      const banners = shadow(element).getAllByRole('banner');
      expect(banners).toHaveLength(1);
      expect(banners[0]?.tagName).toBe('HEADER');
      expect(banners[0]?.classList.contains('bcds-header')).toBe(true);
    });

    it('links the B.C. logo to logo-href (default "/") with the Government of British Columbia title', async () => {
      const element = await mount();
      const logo = shadow(element).getByTitle('Government of British Columbia');
      expect(logo.tagName).toBe('A');
      expect(logo.getAttribute('href')).toBe('/');
      expect(logo.querySelector('svg#bcgov-logo-header path')).not.toBeNull();

      element.setAttribute('logo-href', '/portal');
      await element.updateComplete;
      expect(logo.getAttribute('href')).toBe('/portal');
    });

    it('shows the divider and "SDG" as the title by default', async () => {
      const element = await mount();
      expect(element.headerTitle).toBe('SDG');
      expect(element.shadowRoot!.querySelector('.bcds-header--line')).not.toBeNull();
      expect(shadow(element).getByText('SDG').classList.contains('bcds-header--title')).toBe(true);
    });

    it('shows header-title instead, and restores "SDG" when the attribute is removed', async () => {
      const element = await mount({}, { 'header-title': 'My service' });
      expect(shadow(element).getByText('My service').classList.contains('bcds-header--title')).toBe(true);
      expect(shadow(element).queryByText('SDG')).toBeNull();

      element.removeAttribute('header-title');
      await element.updateComplete;
      expect(element.headerTitle).toBe('SDG');
      expect(shadow(element).getByText('SDG')).toBeTruthy();
    });

    it('hides the divider and title for an empty header-title', async () => {
      const element = await mount({}, { 'header-title': '' });
      const root = element.shadowRoot!;
      expect(root.querySelector('.bcds-header--line')).toBeNull();
      expect(root.querySelector('.bcds-header--title')).toBeNull();
    });
  });

  describe('skip links', () => {
    it('renders each skip link as an <a> in a list, in order', async () => {
      const element = await mount({
        skipLinks: [
          { label: 'Skip to main content', href: '#main-content' },
          { label: 'Skip to search', href: '#search' },
        ],
      });
      const links = Array.from(element.shadowRoot!.querySelectorAll('.bcds-header--skiplinks a'));
      expect(links.map((link) => link.textContent)).toEqual(['Skip to main content', 'Skip to search']);
      expect(links.map((link) => link.getAttribute('href'))).toEqual(['#main-content', '#search']);
      // Skip links come before the logo, so they are the first tab stops.
      expect(element.shadowRoot!.querySelector('a')?.textContent).toBe('Skip to main content');
    });

    it('renders no list when skipLinks is empty', async () => {
      const element = await mount();
      expect(element.shadowRoot!.querySelector('.bcds-header--skiplinks')).toBeNull();
      expect(element.skipLinks).toEqual([]);
    });
  });

  describe('nav items', () => {
    it('renders nav items as links in <nav aria-label="Main">', async () => {
      const element = await mount({ navItems });
      const nav = shadow(element).getByRole('navigation', { name: 'Main' });
      const links = Array.from(nav.querySelectorAll('li > a'));
      expect(links.map((link) => link.textContent)).toEqual(['Home', 'Help']);
      expect(links.map((link) => link.getAttribute('href'))).toEqual(['/', '/help']);
    });

    it('marks current items with aria-current="page"', async () => {
      const element = await mount({ navItems });
      expect(shadow(element).getByRole('link', { name: 'Help' }).getAttribute('aria-current')).toBe('page');
      expect(shadow(element).getByRole('link', { name: 'Home' }).hasAttribute('aria-current')).toBe(false);
    });

    it('uses nav-label as the nav accessible name', async () => {
      const element = await mount({ navItems }, { 'nav-label': 'Primary' });
      expect(shadow(element).getByRole('navigation', { name: 'Primary' })).toBeTruthy();
      expect(shadow(element).queryByRole('navigation', { name: 'Main' })).toBeNull();
    });

    it('renders no <nav> when navItems is empty', async () => {
      const element = await mount({ signInHref: '/login' });
      expect(shadow(element).queryByRole('navigation')).toBeNull();
      expect(shadow(element).getByRole('link', { name: 'Sign in' })).toBeTruthy();
    });
  });

  describe('navigateFn', () => {
    it('calls navigateFn with the href and prevents default on a plain click of a nav item or the logo', async () => {
      const navigateFn = vi.fn<(href: string) => void>();
      const element = await mount({ navItems, navigateFn });
      expect(click(shadow(element).getByRole('link', { name: 'Help' })).defaultPrevented).toBe(true);
      expect(click(shadow(element).getByTitle('Government of British Columbia')).defaultPrevented).toBe(true);
      expect(navigateFn.mock.calls).toEqual([['/help'], ['/']]);
    });

    it('leaves modified clicks (ctrl/meta/shift/alt, non-primary) to the browser', async () => {
      const navigateFn = vi.fn<(href: string) => void>();
      const element = await mount({ navItems, navigateFn });
      const help = shadow(element).getByRole('link', { name: 'Help' });
      const modified = [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }];
      const prevented = modified.map((init) => {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
        help.dispatchEvent(event);
        return event.defaultPrevented;
      });
      expect(prevented).toEqual([false, false, false, false, false]);
      expect(navigateFn).not.toHaveBeenCalled();
    });

    it('lets links navigate normally when navigateFn is unset', async () => {
      const element = await mount({ navItems });
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      shadow(element).getByRole('link', { name: 'Help' }).dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(element.navigateFn).toBeUndefined();
    });
  });

  describe('account control', () => {
    it('shows the avatar menu trigger when user is set', async () => {
      const element = await mount({ user: { name: 'Ada Lovelace' }, signInHref: '/login' });
      const trigger = shadow(element).getByRole('button', { name: 'Account menu for Ada Lovelace' });
      expect(trigger.textContent?.trim()).toBe('AL');
      expect(shadow(element).queryByRole('link', { name: 'Sign in' })).toBeNull();
    });

    it('shows a Sign in link to sign-in-href when signed out', async () => {
      const element = await mount({}, { 'sign-in-href': '/api/auth/login?returnTo=%2F' });
      const signIn = shadow(element).getByRole('link', { name: 'Sign in' });
      expect(signIn.getAttribute('href')).toBe('/api/auth/login?returnTo=%2F');
      expect(shadow(element).queryByRole('button')).toBeNull();
    });

    it('shows no account control when there is no user and no sign-in-href', async () => {
      const element = await mount({ navItems });
      expect(shadow(element).queryByRole('link', { name: 'Sign in' })).toBeNull();
      expect(shadow(element).queryByRole('button')).toBeNull();
      expect(shadow(element).getAllByRole('link')).toHaveLength(3);
    });

    it('renders nothing in the nav area when there are no nav items and no account control', async () => {
      const element = await mount();
      const root = element.shadowRoot!;
      expect(root.querySelector('.nav-area')).toBeNull();
      expect(root.querySelector('.nav-menu')).toBeNull();
      expect(shadow(element).queryByRole('button')).toBeNull();
    });
  });

  describe('registration', () => {
    it('defines sdg-header once and tolerates being imported again', async () => {
      expect(customElements.get('sdg-header')).toBe(SdgHeader);
      vi.resetModules();
      await expect(import('./index.js')).resolves.toBeDefined();
      expect(customElements.get('sdg-header')).toBe(SdgHeader);
      expect(document.createElement('sdg-header')).toBeInstanceOf(SdgHeader);
    });

    it('exports defineSdgHeader, which is safe to call again', async () => {
      const { defineSdgHeader } = await import('./index.js');
      expect(() => defineSdgHeader()).not.toThrow();
      expect(customElements.get('sdg-header')).toBeDefined();
    });
  });
});
