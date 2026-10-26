import { type BoundFunctions, getQueriesForElement, type queries } from '@testing-library/dom';
import { afterEach, vi } from 'vitest';

import '../index.js';
import type { SdgHeader } from '../sdg-header.js';

type Inputs = Partial<
  Pick<
    SdgHeader,
    | 'headerTitle'
    | 'logoHref'
    | 'signInHref'
    | 'navLabel'
    | 'menuLabel'
    | 'skipLinks'
    | 'navItems'
    | 'user'
    | 'signOutFn'
    | 'navigateFn'
  >
>;

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** Appends an `<sdg-header>` with the given attributes and properties and waits for its first render. */
export async function mount(inputs: Inputs = {}, attributes: Record<string, string> = {}): Promise<SdgHeader> {
  const element = document.createElement('sdg-header');
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  Object.assign(element, inputs);
  document.body.append(element);
  await element.updateComplete;
  return element;
}

/** Testing Library queries scoped to the element's shadow root. */
export function shadow(element: SdgHeader): BoundFunctions<typeof queries> {
  if (!element.shadowRoot) throw new Error('sdg-header has no shadow root');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the queries only use querySelectorAll, which a ShadowRoot has.
  return getQueriesForElement(element.shadowRoot as unknown as HTMLElement);
}

/** The focused element inside the shadow root. */
export const activeIn = (element: SdgHeader): Element | null => element.shadowRoot?.activeElement ?? null;

/** Stubs matchMedia with one controllable query; `set` fires a change like a resize across the breakpoint. */
export function stubMatchMedia(initial: boolean): { set: (matches: boolean) => void } {
  let matches = initial;
  type Listener = (event: { matches: boolean; media: string }) => void;
  const listeners = new Set<Listener>();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    get matches() {
      return matches;
    },
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  }));
  return {
    set(next) {
      matches = next;
      for (const listener of listeners) listener({ matches: next, media: '' });
    },
  };
}
