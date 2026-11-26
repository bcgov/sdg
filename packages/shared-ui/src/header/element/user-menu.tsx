import { faAngleDown, faCircleUser, faGear, faRightFromBracket } from '@fortawesome/free-solid-svg-icons';
import type { JSX, RefObject } from 'preact';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';

import { Icon } from './icon.js';
import { hostOf } from './shadow.js';

const BUTTON_ID = 'user-menu-button';
const MENU_ID = 'user-menu';

export interface UserMenuProps {
  userName: string;
  /** SDG's settings page (`SETTINGS_HREF`). */
  settingsHref: string;
  /** The Settings link's click; decides whether to dispatch `sdg-settings`. */
  onSettingsClick: (event: MouseEvent) => void;
  onLogoutClick: () => void;
}

/** Which item gets focus when the menu opens: the first (click, Enter, Space, ArrowDown) or the last (ArrowUp). */
type OpenFocus = 'first' | 'last';

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return menu ? [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];
}

/** Arrow, Home and End keys move focus between items, wrapping at the ends (WAI-ARIA menu pattern). */
function moveFocus(menu: HTMLElement, from: EventTarget | null, key: string): boolean {
  const items = menuItems(menu);
  const current = from instanceof HTMLElement ? items.indexOf(from) : -1;
  const last = items.length - 1;
  const next: Record<string, number> = {
    ArrowDown: current >= last ? 0 : current + 1,
    ArrowUp: current <= 0 ? last : current - 1,
    Home: 0,
    End: last,
  };
  const index = next[key];
  if (index === undefined) return false;
  items[index]?.focus();
  return true;
}

/**
 * While the menu is open: focuses the requested item, closes on Escape (focus back to the button), Tab (focus moves
 * on as usual) and a pointerdown outside the menu and its button. The composed path crosses the shadow boundary.
 */
function useMenuBehaviour(
  openFocus: OpenFocus | null,
  menuRef: RefObject<HTMLDivElement | null>,
  buttonRef: RefObject<HTMLButtonElement | null>,
  close: () => void,
): void {
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const button = buttonRef.current;
    if (!openFocus || !menu || !button || !hostOf(menu)) return undefined;
    const items = menuItems(menu);
    (openFocus === 'first' ? items[0] : items.at(-1))?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        button.focus();
      } else if (event.key === 'Tab') {
        close();
      } else if (moveFocus(menu, event.target, event.key)) {
        event.preventDefault();
      }
    };
    const onPointerDown = (event: Event): void => {
      const path = event.composedPath();
      if (!path.includes(menu) && !path.includes(button)) close();
    };
    menu.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      menu.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [openFocus, menuRef, buttonRef, close]);
}

// The WAI-ARIA menu button pattern: a primary button with the user's name opens a menu of Settings (a link, so
// modified clicks open it in a new tab) and Log Out (a button: signing out is the host's action, not a URL).
export function UserMenu({
  userName,
  settingsHref,
  onSettingsClick,
  onLogoutClick,
}: Readonly<UserMenuProps>): JSX.Element {
  const [openFocus, setOpenFocus] = useState<OpenFocus | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpenFocus(null), []);
  const open = openFocus !== null;

  useMenuBehaviour(openFocus, menuRef, buttonRef, close);

  const onButtonKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setOpenFocus(event.key === 'ArrowDown' ? 'first' : 'last');
  };
  const onSettings = (event: MouseEvent): void => {
    onSettingsClick(event);
    close();
  };
  const onLogout = (): void => {
    close();
    buttonRef.current?.focus();
    onLogoutClick();
  };

  return (
    <div className="user-menu" data-part="user-menu">
      <button
        ref={buttonRef}
        id={BUTTON_ID}
        type="button"
        className="button button-secondary button-icon button-collapsible user-menu-button"
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={MENU_ID}
        onClick={() => setOpenFocus(open ? null : 'first')}
        onKeyDown={onButtonKeyDown}
      >
        <Icon icon={faCircleUser} />
        <span className="user-name button-label">{userName}</span>
        <Icon icon={faAngleDown} className="button-caret" />
      </button>
      <div ref={menuRef} id={MENU_ID} className="menu" role="menu" aria-labelledby={BUTTON_ID} hidden={!open}>
        <a className="menu-item" role="menuitem" tabIndex={-1} href={settingsHref} onClick={onSettings}>
          <Icon icon={faGear} />
          Settings
        </a>
        <button type="button" className="menu-item menu-item-danger" role="menuitem" tabIndex={-1} onClick={onLogout}>
          <Icon icon={faRightFromBracket} />
          Log Out
        </button>
      </div>
    </div>
  );
}
