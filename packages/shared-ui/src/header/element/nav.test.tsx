import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { defineSdgHeader, SdgHeaderElement } from './sdg-header-element.js';

// Read from disk: Vitest does not process CSS, so a ?inline or ?raw import is empty here.
const css = readFileSync(join(import.meta.dirname, 'nav.css'), 'utf8');

type ChangeListener = (event: { matches: boolean }) => void;

/** jsdom has no matchMedia: a stub whose `(min-width: 768px)` answer the test sets and changes. */
function stubViewport(initialWide: boolean): { setWide: (wide: boolean) => void } {
  let wide = initialWide;
  const listeners = new Set<ChangeListener>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return wide;
    },
    addEventListener: (_type: 'change', listener: ChangeListener) => listeners.add(listener),
    removeEventListener: (_type: 'change', listener: ChangeListener) => listeners.delete(listener),
  }));
  return {
    setWide(next) {
      wide = next;
      for (const listener of listeners) listener({ matches: next });
    },
  };
}

/** Lets slotchange and Preact's batched re-renders run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function link(text: string, current = false): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.slot = 'nav';
  anchor.href = `/${text.toLowerCase()}`;
  anchor.textContent = text;
  if (current) anchor.setAttribute('aria-current', 'page');
  return anchor;
}

async function mount(links: HTMLAnchorElement[], attributes: Record<string, string> = {}): Promise<SdgHeaderElement> {
  const element = new SdgHeaderElement();
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.append(...links);
  document.body.append(element);
  await settle();
  return element;
}

function shadow(element: SdgHeaderElement): ShadowRoot {
  if (!element.shadowRoot) throw new Error('sdg-header has no open shadow root');
  return element.shadowRoot;
}

function landmark(element: SdgHeaderElement): HTMLElement | null {
  return shadow(element).querySelector('nav');
}

function menuButton(element: SdgHeaderElement): HTMLButtonElement | null {
  return shadow(element).querySelector('button[aria-controls]');
}

function panel(element: SdgHeaderElement): HTMLElement {
  const found = shadow(element).querySelector<HTMLElement>('[data-part="nav-panel"]');
  if (!found) throw new Error('sdg-header has no nav panel');
  return found;
}

function requireButton(element: SdgHeaderElement): HTMLButtonElement {
  const button = menuButton(element);
  if (!button) throw new Error('sdg-header has no menu button');
  return button;
}

async function openMenu(element: SdgHeaderElement): Promise<HTMLButtonElement> {
  const button = requireButton(element);
  button.click();
  await settle();
  return button;
}

beforeAll(() => {
  defineSdgHeader();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('<sdg-header> nav', () => {
  beforeEach(() => {
    stubViewport(true);
  });

  it('slots the links as given and adds no selected style for the aria-current one', async () => {
    const links = [link('Home'), link('Services', true), link('Help')];
    const element = await mount(links);

    const slot = shadow(element).querySelector<HTMLSlotElement>('slot[name="nav"]');
    expect(slot?.assignedElements()).toEqual(links);
    expect(links[1]?.getAttribute('aria-current')).toBe('page');
    expect(css).not.toMatch(/aria-current/);
  });

  it('is a labelled nav landmark around the slot', async () => {
    const element = await mount([link('Home')]);

    expect(landmark(element)?.getAttribute('aria-label')).toBe('Main');
    expect(landmark(element)?.querySelector('slot[name="nav"]')).not.toBeNull();
  });

  it('keeps the links visible and focusable with no menu button on wide screens', async () => {
    const links = [link('Home'), link('Help')];
    const element = await mount(links);

    expect(menuButton(element)).toBeNull();
    expect(panel(element).hidden).toBe(false);
    links[0]?.focus();
    expect(document.activeElement).toBe(links[0]);
  });

  it('renders no menu button and no landmark without links, and both once a link arrives', async () => {
    stubViewport(false);
    const element = await mount([]);

    expect(landmark(element)).toBeNull();
    expect(menuButton(element)).toBeNull();

    element.append(link('Home'));
    await settle();

    expect(landmark(element)).not.toBeNull();
    expect(menuButton(element)).not.toBeNull();
  });

  it('shows links a host adds after the element upgraded, without a re-render call', async () => {
    const element = await mount([link('Home')]);
    const added = link('Help');

    element.append(added);
    await settle();

    expect(shadow(element).querySelector<HTMLSlotElement>('slot[name="nav"]')?.assignedElements()).toContain(added);
  });
});

describe('<sdg-header> narrow-screen menu', () => {
  let viewport: { setWide: (wide: boolean) => void };

  beforeEach(() => {
    viewport = stubViewport(false);
  });

  it('starts closed and opens on activation', async () => {
    const element = await mount([link('Home')]);
    const button = requireButton(element);

    expect(button.type).toBe('button');
    // A bars icon, named "Menu" for assistive technology since it shows no text.
    expect(button.getAttribute('aria-label')).toBe('Menu');
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(button.getAttribute('aria-controls')).toBe(panel(element).id);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel(element).hidden).toBe(true);

    await openMenu(element);

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(panel(element).hidden).toBe(false);
  });

  it('closes on Escape and returns focus to the menu button', async () => {
    const links = [link('Home')];
    const element = await mount(links);
    const button = await openMenu(element);
    links[0]?.focus();

    links[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    await settle();

    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel(element).hidden).toBe(true);
    expect(shadow(element).activeElement).toBe(button);
  });

  it('closes on a link click and moves focus to the menu button', async () => {
    const links = [link('Home')];
    const element = await mount(links);
    const button = await openMenu(element);
    links[0]?.addEventListener('click', (event) => event.preventDefault());

    links[0]?.click();
    await settle();

    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(shadow(element).activeElement).toBe(button);
  });

  it('closes on a pointerdown outside the element but not inside it', async () => {
    const links = [link('Home')];
    const element = await mount(links);
    const button = await openMenu(element);

    links[0]?.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    await settle();
    expect(button.getAttribute('aria-expanded')).toBe('true');

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    await settle();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when focus leaves the header', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const links = [link('Home')];
    const element = await mount(links);
    const button = await openMenu(element);
    links[0]?.focus();

    outside.focus();
    await settle();

    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes and resets aria-expanded when the viewport becomes wide', async () => {
    const element = await mount([link('Home')]);
    await openMenu(element);

    viewport.setWide(true);
    await settle();

    expect(menuButton(element)).toBeNull();
    expect(panel(element).hidden).toBe(false);

    viewport.setWide(false);
    await settle();

    expect(requireButton(element).getAttribute('aria-expanded')).toBe('false');
    expect(panel(element).hidden).toBe(true);
  });

  it('keeps the auth control in the utility row', async () => {
    const element = await mount([link('Home')], { 'login-href': '/auth/login' });

    expect(requireButton(element)).toBeDefined();
    expect(shadow(element).querySelector('[data-part="utility"] a')?.textContent).toBe('Log In');
  });
});
