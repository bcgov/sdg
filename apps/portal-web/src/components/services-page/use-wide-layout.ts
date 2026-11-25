import { useEffect, useRef } from 'react';

/** The wide (desktop) layout, where Search tools is a sidebar; below it, the sheet. Matches the CSS breakpoints. */
export const WIDE_LAYOUT_QUERY = '(min-width: 1025px)';

/** Calls `onEnter` each time the viewport grows into the wide layout (not on mount, and not when it shrinks). */
export function useOnEnterWideLayout(onEnter: () => void): void {
  // The latest callback, so the listener needn't be re-registered when it changes.
  const onEnterRef = useRef(onEnter);
  useEffect(() => {
    onEnterRef.current = onEnter;
  }, [onEnter]);

  useEffect(() => {
    const wide = window.matchMedia(WIDE_LAYOUT_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) onEnterRef.current();
    };
    wide.addEventListener('change', handleChange);
    return () => wide.removeEventListener('change', handleChange);
  }, []);
}
