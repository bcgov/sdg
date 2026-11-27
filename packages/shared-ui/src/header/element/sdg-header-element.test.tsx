import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { HEADER_EVENTS, HEADER_TAG } from '../contract.js';
import { backToSdgHref } from './back-to-sdg.js';
import { defineSdgHeader, SdgHeaderElement } from './sdg-header-element.js';

// jsdom serves the header from the page's own origin (SDG itself), where Back to SDG never shows; back-to-sdg.test.ts
// covers when it does, so these tests choose its answer.
vi.mock('./back-to-sdg.js', () => ({ backToSdgHref: vi.fn<() => string | null>(() => null) }));

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

function containers(element: SdgHeaderElement): HTMLElement[] {
  return [...shadow(element).querySelectorAll<HTMLElement>('[data-part="container"]')];
}

function loginLink(element: SdgHeaderElement): HTMLAnchorElement | null {
  return utilityRow(element).querySelector('a[data-part="login"]');
}

function setupLink(element: SdgHeaderElement): HTMLAnchorElement | null {
  return utilityRow(element).querySelector('a[data-part="setup"]');
}

function homeLink(element: SdgHeaderElement): HTMLAnchorElement {
  const link = shadow(element).querySelector<HTMLAnchorElement>('[data-part="main"] a[data-part="lockup"]');
  if (!link) throw new Error('sdg-header has no home link');
  return link;
}

function menuButton(element: SdgHeaderElement): HTMLButtonElement | null {
  return utilityRow(element).querySelector('button[aria-haspopup="menu"]');
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
    expect(menuButton(element)).toBeNull();
  });

  it('shows Set up, linking to the BC Services Card account set-up page, right before Log In when signed out', () => {
    const element = mount({ 'login-href': '/auth/login' });

    expect(setupLink(element)?.textContent).toBe('Set up');
    expect(setupLink(element)?.getAttribute('href')).toBe('https://id.gov.bc.ca/account/setup-instruction');
    expect(setupLink(element)?.nextElementSibling).toBe(loginLink(element));
  });

  it('shows no Set up when a user is signed in', () => {
    const element = mount({ 'login-href': '/auth/login', 'user-name': 'Jane Doe' });

    expect(setupLink(element)).toBeNull();
  });

  it('shows a user menu button with the name, and no Log In, when a user is signed in', () => {
    const element = mount({ 'login-href': '/auth/login', 'user-name': 'Jane Doe' });

    expect(menuButton(element)?.textContent).toBe('Jane Doe');
    expect(menuButton(element)?.type).toBe('button');
    expect(utilityRow(element).querySelector('a[href="/auth/login"]')).toBeNull();
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
    expect(menuButton(element)).toBeNull();
    expect(utilityRow(element).textContent).not.toContain('Jane Doe');
  });
});

describe('<sdg-header> Back to SDG', () => {
  it('links back to the SDG page the visitor came from, at the start of the utility row before Set up and Log In', () => {
    vi.mocked(backToSdgHref).mockReturnValueOnce('https://sdg.gov.bc.ca/services');
    const element = mount({ 'login-href': '/auth/login' });

    const links = [...utilityRow(element).querySelectorAll('a')];
    expect(links.map((link) => link.textContent)).toEqual(['Back to SDG', 'Set up', 'Log In']);
    expect(links[0]?.getAttribute('href')).toBe('https://sdg.gov.bc.ca/services');
  });

  it('shows no Back to SDG link when the visitor did not come from SDG', () => {
    const element = mount({ 'login-href': '/auth/login' });

    expect(utilityRow(element).querySelector('[data-part="back"]')).toBeNull();
  });
});

describe('<sdg-header> main row', () => {
  it('shows the full logo, its mark for small screens and the fixed brand, with no divider or title by default', () => {
    const root = shadow(mount({}));
    const main = root.querySelector('[data-part="main"]');

    expect(main?.querySelector('[data-part="logo-full"]')?.getAttribute('aria-label')).toBe(
      'Government of British Columbia',
    );
    expect(main?.querySelector('[data-part="logo-mark"]')?.getAttribute('aria-label')).toBe(
      'Government of British Columbia',
    );
    // Both names render; styles.css shows "Single Digital Gateway" from 1025px and "SDG" below.
    expect(main?.querySelector('[data-part="brand"] .brand-full')?.textContent).toBe('Single Digital Gateway');
    expect(main?.querySelector('[data-part="brand"] .brand-short')?.textContent).toBe('SDG');
    expect(main?.querySelector('[data-part="separator"]')).toBeNull();
    expect(main?.querySelector('[data-part="title"]')).toBeNull();
    expect(root.querySelector('[data-part="title-row"]')).toBeNull();
  });

  it('dispatches a cancelable sdg-home on a plain click on the logo and lets the link navigate', () => {
    const element = mount({});
    const onHome = vi.fn<(event: Event) => void>();
    element.addEventListener(HEADER_EVENTS.home, onHome);

    expect(click(homeLink(element))).toBe(false);
    expect(onHome).toHaveBeenCalledOnce();
    expect(onHome.mock.calls[0]?.[0]).toMatchObject({ bubbles: true, composed: true, cancelable: true });
  });

  it('prevents the navigation when a listener cancels sdg-home', () => {
    const element = mount({});
    element.addEventListener(HEADER_EVENTS.home, (event) => event.preventDefault());

    expect(click(homeLink(element))).toBe(true);
  });

  it('dispatches no sdg-home on a modified click', () => {
    const element = mount({});
    const onHome = vi.fn<(event: Event) => void>();
    element.addEventListener(HEADER_EVENTS.home, onHome);

    expect(click(homeLink(element), { metaKey: true })).toBe(false);
    expect(onHome).not.toHaveBeenCalled();
  });

  it("links the logo and brand, not the site title, to SDG's home page", () => {
    const root = shadow(mount({ 'site-title': 'Service Portal' }));
    const lockup = root.querySelector('[data-part="main"] [data-part="lockup"]');

    expect(lockup).toBeInstanceOf(HTMLAnchorElement);
    // jsdom serves the header from the page's own origin, as SDG's own pages do.
    expect(lockup?.getAttribute('href')).toBe(`${window.location.origin}/`);
    expect(lockup?.querySelector('[data-part="logo-full"]')).not.toBeNull();
    expect(lockup?.querySelector('[data-part="brand"]')).not.toBeNull();
    expect(root.querySelector('[data-part="main"] [data-part="title"]')?.closest('a')).toBeNull();
  });

  it('shows the site title after SDG and a divider, and in the small-screen title row, and updates both', () => {
    const element = mount({ 'site-title': 'Service Portal' });
    const root = shadow(element);
    const titles = (): (string | null | undefined)[] => [
      root.querySelector('[data-part="main"] [data-part="title"]')?.textContent,
      root.querySelector('[data-part="title-row"] [data-part="title-row-title"]')?.textContent,
    ];

    const parts = [...(root.querySelector('[data-part="main"] [data-part="container"]')?.children ?? [])].map((child) =>
      child.getAttribute('data-part'),
    );
    expect(parts).toEqual(['lockup', 'separator', 'title', 'nav']);
    expect(titles()).toEqual(['Service Portal', 'Service Portal']);

    element.setAttribute('site-title', 'Another Service');
    expect(titles()).toEqual(['Another Service', 'Another Service']);

    element.removeAttribute('site-title');
    expect(root.querySelector('[data-part="separator"]')).toBeNull();
    expect(root.querySelector('[data-part="title-row"]')).toBeNull();
  });

  it('is a banner landmark', () => {
    expect(shadow(mount({})).querySelector('header')).not.toBeNull();
  });
});

describe('<sdg-header> container', () => {
  it("wraps each row's contents in a max-width container by default", () => {
    const element = mount({ 'site-title': 'My Service', 'login-href': '/login' });
    const [utility, main, titleRow] = containers(element);
    expect(containers(element)).toHaveLength(3);
    expect(utility?.parentElement?.dataset['part']).toBe('utility');
    expect(main?.parentElement?.dataset['part']).toBe('main');
    expect(utility?.contains(loginLink(element))).toBe(true);
    expect(main?.querySelector('[data-part="title"]')?.textContent).toBe('My Service');
    expect(titleRow?.parentElement?.dataset['part']).toBe('title-row');
    for (const container of containers(element)) expect(container.classList.contains('container-fluid')).toBe(false);
  });

  it('makes both containers full width with the fluid attribute, and switches back when it is removed', () => {
    const element = mount({ fluid: '' });
    const fluidStates = (): boolean[] => containers(element).map((c) => c.classList.contains('container-fluid'));
    expect(fluidStates()).toEqual([true, true]);
    element.removeAttribute('fluid');
    expect(fluidStates()).toEqual([false, false]);
    element.setAttribute('fluid', '');
    expect(fluidStates()).toEqual([true, true]);
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
