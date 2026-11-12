import { act } from '@testing-library/react';
import { vi } from 'vitest';

import { MOBILE_QUERY } from '../components/app-shell/sidebar-context';

type Listener = (event: { matches: boolean; media: string }) => void;

/**
 * Stubs `matchMedia` (jsdom has none) so the shell's narrow-screen query matches or not; other queries never match.
 * `set` fires a change like a resize across the 768px breakpoint. test-setup stubs a wide screen before every test.
 */
export function stubViewport(narrow: boolean): { set: (narrow: boolean) => void } {
  let matches = narrow;
  const listeners = new Set<Listener>();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    get matches() {
      return media === MOBILE_QUERY && matches;
    },
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  }));
  return {
    set(next) {
      matches = next;
      act(() => {
        for (const listener of listeners) listener({ matches: next, media: MOBILE_QUERY });
      });
    },
  };
}
