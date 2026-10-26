import { cleanup, render } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SdgHeader as SdgHeaderElement } from '../index.js';
import { SdgHeader, type SdgHeaderProps } from './index.js';

afterEach(cleanup);

async function renderHeader(props: SdgHeaderProps) {
  const result = render(createElement(SdgHeader, props));
  const element = result.container.querySelector('sdg-header');
  if (!(element instanceof SdgHeaderElement)) throw new Error('<sdg-header> was not rendered as the element');
  await element.updateComplete;
  return { ...result, element };
}

describe('@repo/sdg-header/react <SdgHeader>', () => {
  it('renders one registered <sdg-header> element', async () => {
    const { container, element } = await renderHeader({});
    expect(container.querySelectorAll('sdg-header')).toHaveLength(1);
    expect(customElements.get('sdg-header')).toBe(SdgHeaderElement);
    expect(element.shadowRoot?.querySelector('header.bcds-header')).not.toBeNull();
  });

  it('passes string props as kebab-case attributes', async () => {
    const { element } = await renderHeader({
      headerTitle: 'SDG',
      logoHref: '/home',
      signInHref: '/login',
      navLabel: 'Primary',
      menuLabel: 'Site menu',
      id: 'site-header',
      className: 'site-header',
    });
    expect(element.getAttribute('header-title')).toBe('SDG');
    expect(element.getAttribute('logo-href')).toBe('/home');
    expect(element.getAttribute('sign-in-href')).toBe('/login');
    expect(element.getAttribute('nav-label')).toBe('Primary');
    expect(element.getAttribute('menu-label')).toBe('Site menu');
    expect(element.id).toBe('site-header');
    expect(element.className).toBe('site-header');
    expect(element.headerTitle).toBe('SDG');
    expect(element.signInHref).toBe('/login');
  });

  it('passes arrays, user and functions as properties', async () => {
    const skipLinks = [{ label: 'Skip to main content', href: '#main-content' }];
    const navItems = [{ label: 'Help', href: '/help', current: true }];
    const user = { name: 'Ada Lovelace', email: 'ada@example.com' };
    const signOutFn = vi.fn<() => void>();
    const navigateFn = vi.fn<(href: string) => void>();
    const { element } = await renderHeader({ skipLinks, navItems, user, signOutFn, navigateFn });
    expect(element.skipLinks).toBe(skipLinks);
    expect(element.navItems).toBe(navItems);
    expect(element.user).toBe(user);
    expect(element.signOutFn).toBe(signOutFn);
    expect(element.navigateFn).toBe(navigateFn);
    expect(element.hasAttribute('navitems')).toBe(false);
  });

  it('shows "SDG" by default and restores it when headerTitle is removed', async () => {
    const { element, rerender } = await renderHeader({});
    expect(element.hasAttribute('header-title')).toBe(false);
    expect(element.shadowRoot?.querySelector('.bcds-header--title')?.textContent).toBe('SDG');

    rerender(createElement(SdgHeader, { headerTitle: 'My service' }));
    await element.updateComplete;
    expect(element.shadowRoot?.querySelector('.bcds-header--title')?.textContent).toBe('My service');

    rerender(createElement(SdgHeader, {}));
    await element.updateComplete;
    expect(element.headerTitle).toBe('SDG');
    expect(element.shadowRoot?.querySelector('.bcds-header--title')?.textContent).toBe('SDG');
  });

  it('routes nav clicks through navigateFn', async () => {
    const navigateFn = vi.fn<(href: string) => void>();
    const { element } = await renderHeader({ navItems: [{ label: 'Help', href: '/help' }], navigateFn });
    const help = element.shadowRoot!.querySelector<HTMLAnchorElement>('a.nav-link');
    await userEvent.click(help!);
    expect(navigateFn).toHaveBeenCalledWith('/help');
  });

  it('gives the element empty lists and a null user for omitted or removed props', async () => {
    const { element, rerender } = await renderHeader({
      navItems: [{ label: 'Help', href: '/help' }],
      skipLinks: [{ label: 'Skip', href: '#main' }],
      user: { name: 'Ada Lovelace' },
    });
    expect(element.navItems).toHaveLength(1);

    rerender(createElement(SdgHeader, {}));
    await element.updateComplete;
    expect(element.navItems).toEqual([]);
    expect(element.skipLinks).toEqual([]);
    expect(element.user).toBeNull();
    expect(element.shadowRoot?.querySelector('nav')).toBeNull();
  });
});
