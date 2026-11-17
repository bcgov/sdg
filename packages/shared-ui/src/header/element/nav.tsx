import type { ComponentChildren, JSX, RefObject } from 'preact';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';

/** The wide layout: links inline in the main row. Below it they sit behind the menu button (KTD10). */
const WIDE_QUERY = '(min-width: 768px)';
const PANEL_ID = 'nav-panel';

/** The shadow host the nav renders in, so outside clicks and focus moves can be checked against the whole header. */
function hostOf(node: Node | null): Element | null {
  const root = node?.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function isInside(host: Element | null, node: Node): boolean {
  return host !== null && (host.contains(node) || (host.shadowRoot?.contains(node) ?? false));
}

/** Tracks the wide-layout media query. Only called once links exist, so a header without nav never queries it. */
function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  useLayoutEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setWide(event.matches);
    query.addEventListener('change', onChange);
    setWide(query.matches);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return wide;
}

/**
 * While the menu is open, closes it on Escape or a link click (focus back to the menu button), on a pointerdown
 * outside the header (the composed path crosses the shadow boundary) and on focus moving out of the header (R24).
 * Slotted links' events reach the nav through their slot.
 */
function useCloseOnLeave(
  open: boolean,
  navRef: RefObject<HTMLElement | null>,
  buttonRef: RefObject<HTMLButtonElement | null>,
  close: () => void,
): void {
  useLayoutEffect(() => {
    const nav = navRef.current;
    const host = hostOf(nav);
    if (!open || !nav || !host) return undefined;
    const closeAndFocusButton = (): void => {
      close();
      buttonRef.current?.focus();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeAndFocusButton();
    };
    const onClick = (event: MouseEvent): void => {
      if (event.target instanceof Element && event.target.closest('a')) closeAndFocusButton();
    };
    // Only a move to a known element outside the header closes it: a null relatedTarget is a window switch.
    const onFocusOut = (event: FocusEvent): void => {
      if (event.relatedTarget instanceof Node && !isInside(host, event.relatedTarget)) close();
    };
    const onPointerDown = (event: Event): void => {
      if (!event.composedPath().includes(host)) close();
    };
    nav.addEventListener('keydown', onKeyDown);
    nav.addEventListener('click', onClick);
    nav.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      nav.removeEventListener('keydown', onKeyDown);
      nav.removeEventListener('click', onClick);
      nav.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, navRef, buttonRef, close]);
}

interface MenuNavProps {
  children: ComponentChildren;
}

// The WAI-ARIA disclosure navigation pattern: one panel holds the slot, an inline row when wide and a menu when
// narrow, so slotted links never move between slots. The panel is hidden only while narrow and closed (R24).
function MenuNav({ children }: MenuNavProps): JSX.Element {
  const wide = useWide();
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const menuOpen = open && !wide;

  useLayoutEffect(() => {
    if (wide) setOpen(false);
  }, [wide]);
  useCloseOnLeave(menuOpen, navRef, buttonRef, close);

  return (
    <nav ref={navRef} class={wide ? 'nav' : 'nav nav-narrow'} data-part="nav" aria-label="Main">
      {!wide && (
        <button
          ref={buttonRef}
          type="button"
          class="button button-secondary menu-button"
          aria-expanded={menuOpen ? 'true' : 'false'}
          aria-controls={PANEL_ID}
          onClick={() => setOpen(!open)}
        >
          Menu
        </button>
      )}
      <div class="nav-panel" id={PANEL_ID} data-part="nav-panel" hidden={!wide && !menuOpen}>
        {children}
      </div>
    </nav>
  );
}

/**
 * The nav slot. Until the host assigns an element to `slot="nav"` there is no landmark and no menu button, only the
 * slot itself, so it can report links that arrive later (`slotchange`, no re-render call needed).
 */
export function Nav(): JSX.Element {
  const [hasLinks, setHasLinks] = useState(false);
  const slotRef = useRef<HTMLSlotElement>(null);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return undefined;
    const update = (): void => setHasLinks(slot.assignedElements().length > 0);
    slot.addEventListener('slotchange', update);
    update();
    return () => slot.removeEventListener('slotchange', update);
  }, [hasLinks]);

  const slot = <slot ref={slotRef} name="nav" />;
  if (!hasLinks) {
    return (
      <div class="nav" data-part="nav">
        {slot}
      </div>
    );
  }
  return <MenuNav>{slot}</MenuNav>;
}
