import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { HEADER_EVENTS, HEADER_TAG } from '../contract.js';
import { defineSdgHeader, SdgHeaderElement } from './sdg-header-element.js';

function mount(attributes: Record<string, string>): SdgHeaderElement {
  const element = new SdgHeaderElement();
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  document.body.append(element);
  return element;
}

function shadow(element: SdgHeaderElement): ShadowRoot {
  if (!element.shadowRoot) throw new Error('sdg-header has no open shadow root');
  return element.shadowRoot;
}

function utilityRow(element: SdgHeaderElement): HTMLElement {
  const row = shadow(element).querySelector<HTMLElement>('[data-part="utility"]');
  if (!row) throw new Error('sdg-header has no utility row');
  return row;
}

function loginLink(element: SdgHeaderElement): HTMLAnchorElement | null {
  return utilityRow(element).querySelector('a');
}

function logoutButton(element: SdgHeaderElement): HTMLButtonElement | null {
  return utilityRow(element).querySelector('button');
}

/**
 * Clicks `target` and returns whether the click's default was prevented by the time it reached `window`. The click
 * is then cancelled there, because jsdom does not implement link navigation.
 */
function click(target: Element, init: MouseEventInit = {}): boolean {
  let prevented = false;
  const observe = (event: Event): void => {
    prevented = event.defaultPrevented;
    event.preventDefault();
  };
  window.addEventListener('click', observe);
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, ...init }));
  window.removeEventListener('click', observe);
  return prevented;
}

beforeAll(() => {
  defineSdgHeader();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('<sdg-header> auth states', () => {
  it('shows a Log In link to login-href when no user is signed in', () => {
    const element = mount({ 'login-href': '/auth/login' });

    expect(loginLink(element)?.textContent).toBe('Log In');
    expect(loginLink(element)?.getAttribute('href')).toBe('/auth/login');
    expect(logoutButton(element)).toBeNull();
  });

  it('shows the user name and a Log Out button, and no Log In, when a user is signed in', () => {
    const element = mount({ 'login-href': '/auth/login', 'user-name': 'Jane Doe' });

    expect(utilityRow(element).textContent).toContain('Jane Doe');
    expect(logoutButton(element)?.textContent).toBe('Log Out');
    expect(logoutButton(element)?.type).toBe('button');
    expect(loginLink(element)).toBeNull();
  });

  it('renders the utility row with no control while the session is unknown', () => {
    const element = mount({});

    expect(utilityRow(element).querySelectorAll('a, button')).toHaveLength(0);
    expect(utilityRow(element).textContent).toBe('');
  });

  it('switches to Log In when user-name is removed, on the same element', () => {
    const element = mount({ 'login-href': '/auth/login', 'user-name': 'Jane Doe' });
    element.removeAttribute('user-name');

    expect(document.querySelector(HEADER_TAG)).toBe(element);
    expect(loginLink(element)?.textContent).toBe('Log In');
    expect(logoutButton(element)).toBeNull();
    expect(utilityRow(element).textContent).not.toContain('Jane Doe');
  });
});

describe('<sdg-header> main row', () => {
  it('shows the logo, a separator and the site title, and updates the title', () => {
    const element = mount({ 'site-title': 'Service Portal' });
    const main = shadow(element).querySelector('[data-part="main"]');

    expect(main?.querySelector('svg[aria-label="Government of British Columbia"]')).not.toBeNull();
    expect(main?.querySelector('[data-part="separator"]')).not.toBeNull();
    expect(main?.querySelector('[data-part="title"]')?.textContent).toBe('Service Portal');

    element.setAttribute('site-title', 'Another Service');
    expect(main?.querySelector('[data-part="title"]')?.textContent).toBe('Another Service');
  });

  it('is a banner landmark', () => {
    expect(shadow(mount({})).querySelector('header')).not.toBeNull();
  });
});

describe('<sdg-header> events', () => {
  it('dispatches sdg-login on a Log In click and lets the link navigate', () => {
    const element = mount({ 'login-href': '/auth/login' });
    const onLogin = vi.fn<(event: Event) => void>();
    element.addEventListener(HEADER_EVENTS.login, onLogin);

    const link = loginLink(element);
    if (!link) throw new Error('no Log In link');
    expect(click(link)).toBe(false);
    expect(onLogin).toHaveBeenCalledOnce();
    expect(onLogin.mock.calls[0]?.[0]).toMatchObject({ bubbles: true, composed: true, cancelable: true });
  });

  it('prevents the navigation when a listener cancels sdg-login', () => {
    const element = mount({ 'login-href': '/auth/login' });
    element.addEventListener(HEADER_EVENTS.login, (event) => event.preventDefault());

    const link = loginLink(element);
    if (!link) throw new Error('no Log In link');
    expect(click(link)).toBe(true);
  });

  it.each<[string, MouseEventInit]>([
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['middle-button', { button: 1 }],
  ])('dispatches no sdg-login on a %s click', (_name, init) => {
    const element = mount({ 'login-href': '/auth/login' });
    const onLogin = vi.fn<(event: Event) => void>();
    element.addEventListener(HEADER_EVENTS.login, onLogin);

    const link = loginLink(element);
    if (!link) throw new Error('no Log In link');
    click(link, init);
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('dispatches one sdg-logout that bubbles to document on a Log Out click', () => {
    const element = mount({ 'user-name': 'Jane Doe' });
    const onLogout = vi.fn<(event: Event) => void>();
    document.addEventListener(HEADER_EVENTS.logout, onLogout);

    const button = logoutButton(element);
    if (!button) throw new Error('no Log Out button');
    click(button);
    document.removeEventListener(HEADER_EVENTS.logout, onLogout);

    expect(onLogout).toHaveBeenCalledOnce();
    expect(onLogout.mock.calls[0]?.[0]?.target).toBe(element);
  });
});

describe('defineSdgHeader', () => {
  it('can be called again without throwing and keeps one definition', () => {
    expect(() => defineSdgHeader()).not.toThrow();
    expect(customElements.get(HEADER_TAG)).toBe(SdgHeaderElement);
  });
});

describe('<sdg-header> CSP', () => {
  it.each<[string, Record<string, string>]>([
    ['unknown', {}],
    ['signed out', { 'login-href': '/auth/login' }],
    ['signed in', { 'user-name': 'Jane Doe' }],
  ])('has no <style> element or style attribute when %s', (_state, attributes) => {
    const root = shadow(mount({ 'site-title': 'Service Portal', ...attributes }));

    expect(root.querySelector('style')).toBeNull();
    expect(root.querySelectorAll('[style]')).toHaveLength(0);
  });
});
