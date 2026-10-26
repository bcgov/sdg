import { css, html, nothing, type CSSResult, type LitElement, type ReactiveController, type TemplateResult } from 'lit';

import { barsIcon, xmarkIcon } from './icons.js';

export interface NavPanelOptions {
  /** Accessible name of the hamburger button. */
  menuLabel: string;
  /** The signed-in user's profile card, or `nothing`. */
  profile: TemplateResult | typeof nothing;
  /** The stacked nav list, or `nothing` when there are no items. */
  navList: TemplateResult | typeof nothing;
  /** Log out or Sign in, pinned to the panel bottom, or `nothing`. */
  footer: TemplateResult | typeof nothing;
}

const panelId = 'nav-panel';

/**
 * Narrow-screen hamburger and the panel it discloses below the header. The panel closes on the toggle, on Escape
 * (returning focus to the toggle), when any link or button in it is activated, and on a pointer press outside.
 */
export class NavPanelController implements ReactiveController {
  isOpen = false;
  readonly #host: LitElement;

  constructor(host: LitElement) {
    this.#host = host;
    host.addController(this);
  }

  hostUpdated(): void {
    if (this.isOpen) this.#measure();
  }

  hostDisconnected(): void {
    this.isOpen = false;
    this.#stopListening();
  }

  render({ menuLabel, profile, navList, footer }: NavPanelOptions): TemplateResult {
    return html`<div class="nav-menu" @keydown=${this.#onKeyDown}>
      <button
        type="button"
        class="button icon-only nav-toggle"
        aria-label=${menuLabel}
        aria-expanded=${this.isOpen ? 'true' : 'false'}
        aria-controls=${panelId}
        @click=${this.#toggle}
      >
        ${this.isOpen ? xmarkIcon : barsIcon}
      </button>
      ${
        this.isOpen
          ? html`<div id=${panelId} class="panel" @click=${this.#onPanelClick}>
              ${profile === nothing ? nothing : html`<div class="panel-profile">${profile}</div>`}
              <div class="panel-items">${navList}</div>
              ${footer === nothing ? nothing : html`<div class="panel-footer">${footer}</div>`}
            </div>`
          : nothing
      }
    </div>`;
  }

  async close(focusToggle = false): Promise<void> {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.#stopListening();
    this.#host.requestUpdate();
    await this.#host.updateComplete;
    if (focusToggle) this.#host.renderRoot.querySelector<HTMLButtonElement>('.nav-toggle')?.focus();
  }

  #stopListening(): void {
    document.removeEventListener('pointerdown', this.#onDocumentPointerDown);
    window.removeEventListener('resize', this.#measure);
    window.removeEventListener('scroll', this.#measure);
  }

  /** Stretches the panel from the header's bottom edge to the viewport bottom, so its items scroll inside it. */
  readonly #measure = (): void => {
    const root = this.#host.renderRoot;
    const panel = root.querySelector<HTMLElement>('.panel');
    if (!panel) return;
    const bottom = Math.max(0, root.querySelector('header')?.getBoundingClientRect().bottom ?? 0);
    panel.style.height = `${window.innerHeight - bottom}px`;
  };

  readonly #toggle = (): void => {
    if (this.isOpen) {
      void this.close();
      return;
    }
    this.isOpen = true;
    // Safari doesn't focus a clicked button; focus it so Escape reaches the menu's keydown listener.
    this.#host.renderRoot.querySelector<HTMLButtonElement>('.nav-toggle')?.focus();
    document.addEventListener('pointerdown', this.#onDocumentPointerDown);
    window.addEventListener('resize', this.#measure);
    // Scrolling the page moves the header, and with it the panel's top edge.
    window.addEventListener('scroll', this.#measure, { passive: true });
    this.#host.requestUpdate();
  };

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.isOpen) return;
    event.preventDefault();
    void this.close(true);
  };

  readonly #onPanelClick = (event: MouseEvent): void => {
    if (event.target instanceof Element && event.target.closest('a, button')) void this.close();
  };

  readonly #onDocumentPointerDown = (event: PointerEvent): void => {
    const root = this.#host.renderRoot.querySelector('.nav-menu');
    if (root && !event.composedPath().includes(root)) void this.close();
  };
}

export const navPanelStyles: CSSResult = css`
  .nav-menu {
    display: flex;
    align-items: center;
    margin-inline-start: auto;
  }

  /*
   * Full header width, from just below its bottom border to the viewport bottom, over the page content. The controller
   * sets the height from the header's measured bottom edge; this fallback assumes the B.C. header's 65px minimum height.
   * It ends at the viewport bottom, so it has no bottom border. The panel itself only scrolls when the viewport is too
   * short for the profile, one item row and the footer.
   */
  .panel {
    position: absolute;
    top: calc(100% + var(--layout-border-width-small, 1px));
    right: 0;
    left: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    height: calc(100dvh - 65px);
    background-color: var(--surface-color-forms-default, #ffffff);
    box-shadow: 0 4px 8px rgb(0 0 0 / 15%);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .panel-profile,
  .panel-items,
  .panel-footer {
    padding: var(--layout-padding-small, 0.5rem) var(--layout-padding-medium, 1rem);
  }

  .panel-profile {
    flex: none;
    border-bottom: var(--layout-border-width-small, 1px) solid var(--surface-color-border-default, #d8d8d8);
  }

  .panel-profile .profile {
    padding-inline: 0;
  }

  /* Fills the height between the profile and the footer and scrolls on its own. */
  .panel-items {
    flex: 1 1 auto;
    min-height: 2.5rem;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .panel .nav-list {
    flex-direction: column;
    align-items: stretch;
    gap: 0;
  }

  /* Stacked items fill the row, so the whole row is the touch target. */
  .panel .nav-link {
    display: flex;
    padding-block: var(--layout-padding-small, 0.5rem);
  }

  /* Pinned to the panel bottom: the items region above takes up the slack. */
  .panel-footer {
    flex: none;
    display: flex;
    flex-direction: column;
    padding: 0;
    border-top: var(--layout-border-width-small, 1px) solid var(--surface-color-border-default, #d8d8d8);
  }

  /* Log out / Sign in span the whole row with their content centred; the focus ring sits inside the panel edge. */
  .panel-footer .button,
  .panel-footer .nav-link {
    justify-content: center;
    align-items: center;
    min-height: 3rem;
    padding: var(--layout-padding-small, 0.5rem) var(--layout-padding-medium, 1rem);
    border-radius: 0;
    outline-offset: calc(-1 * var(--layout-border-width-medium, 2px));
  }

  /* Sign in is the panel's primary action: a B.C. primary button filling the row, with a white focus ring on the fill. */
  .panel-footer .nav-link {
    background-color: var(--surface-color-primary-button-default, #013366);
    color: var(--typography-color-primary-invert, #ffffff);
    text-decoration: none;
  }

  .panel-footer .nav-link:hover {
    background-color: var(--surface-color-primary-button-hover, #1e5189);
  }

  .panel-footer .nav-link:focus-visible {
    outline-color: var(--typography-color-primary-invert, #ffffff);
    outline-offset: calc(-2 * var(--layout-border-width-medium, 2px));
  }
`;
