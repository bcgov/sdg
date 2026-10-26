import { css, html, nothing, type CSSResult, type LitElement, type ReactiveController, type TemplateResult } from 'lit';

import { renderAvatar, type AvatarOptions } from './avatar.js';
import { signOutIcon } from './icons.js';
import type { HeaderUser } from './types.js';

export interface AccountMenuOptions {
  user: HeaderUser;
  signOutFn: (() => void) | undefined;
  avatar: Omit<AvatarOptions, 'size'>;
}

/** Where focus goes when the menu opens: the menu itself (pointer), or its first or last item (keyboard). */
type OpenFocus = 'menu' | 'first' | 'last';

const menuId = 'account-menu';

/** Wide-screen avatar button and its ARIA menu: profile, then Log out when the host can sign out. */
export class AccountMenuController implements ReactiveController {
  isOpen = false;
  readonly #host: LitElement;

  constructor(host: LitElement) {
    this.#host = host;
    host.addController(this);
  }

  hostDisconnected(): void {
    this.isOpen = false;
    document.removeEventListener('pointerdown', this.#onDocumentPointerDown);
  }

  render({ user, signOutFn, avatar }: AccountMenuOptions): TemplateResult {
    const label = `Account menu for ${user.name}`;
    return html`<div class="account-menu">
      <button
        type="button"
        class="button avatar-trigger"
        aria-label=${label}
        aria-haspopup="menu"
        aria-expanded=${this.isOpen ? 'true' : 'false'}
        aria-controls=${this.isOpen ? menuId : nothing}
        @click=${this.#onTriggerClick}
        @keydown=${this.#onTriggerKeyDown}
      >
        ${renderAvatar(user, { size: 'small', ...avatar })}
      </button>
      ${this.isOpen ? this.#renderMenu(label, { user, signOutFn, avatar }) : nothing}
    </div>`;
  }

  #renderMenu(label: string, { user, signOutFn, avatar }: AccountMenuOptions): TemplateResult {
    return html`<div
      id=${menuId}
      class="menu"
      role="menu"
      aria-label=${label}
      tabindex="-1"
      @keydown=${this.#onMenuKeyDown}
    >
      <div class="profile" role="none">
        ${renderAvatar(user, { size: 'medium', ...avatar })}
        <span class="identity">
          <span class="name">${user.name}</span>
          ${user.email ? html`<span class="email">${user.email}</span>` : nothing}
        </span>
      </div>
      ${
        signOutFn
          ? html`<div class="separator" role="separator"></div>
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                tabindex="-1"
                @click=${() => this.#signOut(signOutFn)}
              >
                ${signOutIcon}<span>Log out</span>
              </button>`
          : nothing
      }
    </div>`;
  }

  /** Closes the menu; `focusTrigger` returns focus to the avatar button. */
  async close(focusTrigger = false): Promise<void> {
    if (!this.isOpen) return;
    this.isOpen = false;
    document.removeEventListener('pointerdown', this.#onDocumentPointerDown);
    this.#host.requestUpdate();
    await this.#host.updateComplete;
    if (focusTrigger) this.#query('.avatar-trigger')?.focus();
  }

  async #open(focus: OpenFocus): Promise<void> {
    this.isOpen = true;
    document.addEventListener('pointerdown', this.#onDocumentPointerDown);
    this.#host.requestUpdate();
    await this.#host.updateComplete;
    const items = this.#items();
    const target = focus === 'menu' ? this.#query('.menu') : focus === 'first' ? items[0] : items.at(-1);
    // A menu without items (no signOutFn) takes focus itself, so Escape still works.
    (target ?? this.#query('.menu'))?.focus();
  }

  #signOut(signOutFn: () => void): void {
    void this.close(true);
    signOutFn();
  }

  #query(selector: string): HTMLElement | null {
    return this.#host.renderRoot.querySelector<HTMLElement>(selector);
  }

  #items(): HTMLElement[] {
    return Array.from(this.#host.renderRoot.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  // A keyboard-activated click has detail 0: the keyboard opens onto the first item, the pointer onto the menu.
  readonly #onTriggerClick = (event: MouseEvent): void => {
    if (this.isOpen) void this.close();
    else void this.#open(event.detail === 0 ? 'first' : 'menu');
  };

  readonly #onTriggerKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    void this.#open(event.key === 'ArrowDown' ? 'first' : 'last');
  };

  readonly #onMenuKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      void this.close(true);
      return;
    }
    if (event.key === 'Tab') {
      void this.close();
      return;
    }
    const items = this.#items();
    const current = items.findIndex((item) => item === this.#host.shadowRoot?.activeElement);
    const next = nextIndex(event.key, current, items.length);
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  };

  readonly #onDocumentPointerDown = (event: PointerEvent): void => {
    const root = this.#query('.account-menu');
    if (root && event.composedPath().includes(root)) return;
    const hadFocus = root?.contains(this.#host.shadowRoot?.activeElement ?? null) ?? false;
    void this.close(hadFocus);
  };
}

/** Roving focus for the menu items; `undefined` when the key doesn't move focus. */
function nextIndex(key: string, current: number, count: number): number | undefined {
  if (count === 0) return undefined;
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowUp':
      return current <= 0 ? count - 1 : current - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

export const accountMenuStyles: CSSResult = css`
  .account-menu {
    position: relative;
    display: inline-flex;
  }

  /* The avatar is its own visual: no background in any state, a focus ring only for keyboard focus. */
  .avatar-trigger,
  .avatar-trigger:hover {
    min-width: 0;
    min-height: 0;
    padding: 0;
    border-radius: var(--layout-border-radius-circular, 9999px);
    background-color: transparent;
  }

  .menu {
    position: absolute;
    top: calc(100% + var(--layout-margin-xsmall, 0.25rem));
    right: 0;
    z-index: 100;
    box-sizing: border-box;
    min-width: 240px;
    padding: var(--layout-padding-xsmall, 0.25rem);
    border: var(--layout-border-width-small, 1px) solid var(--surface-color-border-default, #d8d8d8);
    border-radius: var(--layout-border-radius-medium, 4px);
    background-color: var(--surface-color-menus-default, #ffffff);
    box-shadow: 0 4px 8px rgb(0 0 0 / 15%);
    outline: none;
  }

  .separator {
    height: var(--layout-border-width-small, 1px);
    margin: var(--layout-margin-xsmall, 0.25rem) 0;
    background-color: var(--surface-color-border-default, #d8d8d8);
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: var(--layout-margin-small, 0.5rem);
    box-sizing: border-box;
    width: 100%;
    padding: var(--layout-padding-small, 0.5rem) var(--layout-padding-medium, 1rem);
    border: none;
    border-radius: var(--layout-border-radius-small, 2px);
    background-color: transparent;
    color: var(--typography-color-danger, #ce3e39);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  /* Highlighted only for the pointer or keyboard focus, in the danger tint. */
  .menu-item:focus {
    outline: none;
  }

  .menu-item:hover,
  .menu-item:focus-visible {
    background-color: var(--support-surface-color-danger, #f4e1e2);
  }
`;
