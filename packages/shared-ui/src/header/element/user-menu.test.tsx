import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { HEADER_EVENTS } from '../contract.js';
import { defineSdgHeader, SdgHeaderElement } from './sdg-header-element.js';

/** Lets Preact's batched re-renders and their layout effects run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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

function button(element: SdgHeaderElement): HTMLButtonElement {
  const found = shadow(element).querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  if (!found) throw new Error('sdg-header has no user menu button');
  return found;
}

function menu(element: SdgHeaderElement): HTMLElement {
  const found = shadow(element).querySelector<HTMLElement>('[role="menu"]');
  if (!found) throw new Error('sdg-header has no user menu');
  return found;
}

function item(element: SdgHeaderElement, name: string): HTMLElement {
  const found = [...menu(element).querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent === name,
  );
  if (!found) throw new Error(`the user menu has no ${name} item`);
  return found;
}

function focused(element: SdgHeaderElement): string | null | undefined {
  return shadow(element).activeElement?.textContent;
}

function key(target: Element, name: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, composed: true }));
}

/** Clicks `target`; returns whether its default was prevented (then cancels it: jsdom does not navigate links). */
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

async function openByClick(element: SdgHeaderElement): Promise<void> {
  click(button(element));
  await settle();
}

const signedIn = { 'user-name': 'Jane Doe' };

beforeAll(() => {
  defineSdgHeader();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('<sdg-header> user menu', () => {
  it('starts closed, with the button naming the user and controlling the menu', () => {
    const element = mount(signedIn);

    expect(button(element).textContent).toBe('Jane Doe');
    expect(button(element).getAttribute('aria-expanded')).toBe('false');
    expect(button(element).getAttribute('aria-controls')).toBe(menu(element).id);
    expect(menu(element).getAttribute('aria-labelledby')).toBe(button(element).id);
    expect(menu(element).hidden).toBe(true);
  });

  it("opens on click with Account Settings (a link to SDG's /account-settings) then Log Out, focusing the first item", async () => {
    const element = mount(signedIn);
    await openByClick(element);

    expect(button(element).getAttribute('aria-expanded')).toBe('true');
    expect(menu(element).hidden).toBe(false);
    expect([...menu(element).querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toEqual([
      'Account Settings',
      'Log Out',
    ]);
    // The module build has no current script, so SDG is the page's own origin.
    expect(item(element, 'Account Settings').getAttribute('href')).toBe(`${window.location.origin}/account-settings`);
    expect(focused(element)).toBe('Account Settings');
  });

  it('closes on a second button click', async () => {
    const element = mount(signedIn);
    await openByClick(element);
    await openByClick(element);

    expect(menu(element).hidden).toBe(true);
    expect(button(element).getAttribute('aria-expanded')).toBe('false');
  });

  it('opens from the keyboard: ArrowDown focuses the first item, ArrowUp the last', async () => {
    const down = mount(signedIn);
    key(button(down), 'ArrowDown');
    await settle();
    expect(focused(down)).toBe('Account Settings');

    const up = mount(signedIn);
    key(button(up), 'ArrowUp');
    await settle();
    expect(focused(up)).toBe('Log Out');
  });

  it('moves focus with the arrow, Home and End keys, wrapping at the ends', async () => {
    const element = mount(signedIn);
    await openByClick(element);

    const steps: [string, string][] = [
      ['ArrowDown', 'Log Out'],
      ['ArrowDown', 'Account Settings'],
      ['ArrowUp', 'Log Out'],
      ['Home', 'Account Settings'],
      ['End', 'Log Out'],
    ];
    for (const [name, expected] of steps) {
      key(shadow(element).activeElement ?? menu(element), name);
      expect(focused(element)).toBe(expected);
    }
  });

  it('closes on Escape and returns focus to the button', async () => {
    const element = mount(signedIn);
    await openByClick(element);
    key(item(element, 'Account Settings'), 'Escape');
    await settle();

    expect(menu(element).hidden).toBe(true);
    expect(shadow(element).activeElement).toBe(button(element));
  });

  it('closes on a pointerdown outside the header, and stays open on one inside the menu', async () => {
    const element = mount(signedIn);
    await openByClick(element);

    item(element, 'Account Settings').dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    await settle();
    expect(menu(element).hidden).toBe(false);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle();
    expect(menu(element).hidden).toBe(true);
  });

  it('dispatches one sdg-logout that bubbles to document on Log Out, and closes the menu', async () => {
    const element = mount(signedIn);
    const onLogout = vi.fn<(event: Event) => void>();
    document.addEventListener(HEADER_EVENTS.logout, onLogout);
    await openByClick(element);
    click(item(element, 'Log Out'));
    await settle();
    document.removeEventListener(HEADER_EVENTS.logout, onLogout);

    expect(onLogout).toHaveBeenCalledOnce();
    expect(onLogout.mock.calls[0]?.[0]?.target).toBe(element);
    expect(menu(element).hidden).toBe(true);
  });

  it('dispatches a cancelable sdg-settings on an Account Settings click and lets the link navigate', async () => {
    const element = mount(signedIn);
    const onSettings = vi.fn<(event: Event) => void>();
    element.addEventListener(HEADER_EVENTS.settings, onSettings);
    await openByClick(element);

    expect(click(item(element, 'Account Settings'))).toBe(false);
    expect(onSettings).toHaveBeenCalledOnce();
    expect(onSettings.mock.calls[0]?.[0]).toMatchObject({ bubbles: true, composed: true, cancelable: true });
  });

  it('prevents the navigation when a listener cancels sdg-settings', async () => {
    const element = mount(signedIn);
    element.addEventListener(HEADER_EVENTS.settings, (event) => event.preventDefault());
    await openByClick(element);

    expect(click(item(element, 'Account Settings'))).toBe(true);
  });

  it('dispatches no sdg-settings on a modified click', async () => {
    const element = mount(signedIn);
    const onSettings = vi.fn<(event: Event) => void>();
    element.addEventListener(HEADER_EVENTS.settings, onSettings);
    await openByClick(element);

    expect(click(item(element, 'Account Settings'), { ctrlKey: true })).toBe(false);
    expect(onSettings).not.toHaveBeenCalled();
  });
});
