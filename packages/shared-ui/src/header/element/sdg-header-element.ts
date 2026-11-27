import { h, render } from 'preact';

import { HEADER_ATTRIBUTES, HEADER_EVENTS, HEADER_TAG } from '../contract.js';
import { backToSdgHref } from './back-to-sdg.js';
import { Header } from './header.js';
import { HOME_HREF, SETTINGS_HREF } from './sdg-origin.js';
import { isPlainPrimaryClick } from './shadow.js';

import navCss from './nav.css?inline';
import css from './styles.css?inline';
import userMenuCss from './user-menu.css?inline';

let sheet: CSSStyleSheet | undefined;

// One constructed sheet shared by every instance. Constructed sheets are not governed by style-src, so neither the
// edge CSP nor implementers' CSPs need a style allowance (KTD7).
function adoptStyles(root: ShadowRoot): void {
  // jsdom has no adoptedStyleSheets; tests assert DOM state only and e2e proves the styles.
  if (!('adoptedStyleSheets' in root)) return;
  if (!sheet) {
    sheet = new CSSStyleSheet();
    // One sheet in a fixed order: later files' rules win ties with the base styles.
    sheet.replaceSync([css, userMenuCss, navCss].join('\n'));
  }
  root.adoptedStyleSheets = [sheet];
}

/** `<sdg-header>`: renders the Preact header into an open shadow root and dispatches its events from the host. */
export class SdgHeaderElement extends HTMLElement {
  static readonly observedAttributes: readonly string[] = Object.values(HEADER_ATTRIBUTES);

  readonly #root: ShadowRoot;
  #returnHref: string | null = null;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    adoptStyles(this.#root);
  }

  connectedCallback(): void {
    // Read on connect, when the page's URL still carries `return-to` from the link the visitor followed.
    this.#returnHref = backToSdgHref();
    this.#render();
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.#render();
  }

  disconnectedCallback(): void {
    render(null, this.#root);
  }

  // Log In, Settings and the logo's home link stay real links: modified clicks (new tab, window) are the browser's, and a plain click
  // navigates unless a listener cancels the event, e.g. to route client-side (KTD9).
  #linkClick(type: string): (event: MouseEvent) => void {
    return (event) => {
      if (!isPlainPrimaryClick(event)) return;
      const linkEvent = new CustomEvent(type, { bubbles: true, composed: true, cancelable: true });
      if (!this.dispatchEvent(linkEvent)) event.preventDefault();
    };
  }

  readonly #onLoginClick = this.#linkClick(HEADER_EVENTS.login);
  readonly #onSettingsClick = this.#linkClick(HEADER_EVENTS.settings);
  readonly #onHomeClick = this.#linkClick(HEADER_EVENTS.home);

  // Log Out only tells the host: signing out is an action the host performs (for example, a POST), not a URL.
  readonly #onLogoutClick = (): void => {
    this.dispatchEvent(new CustomEvent(HEADER_EVENTS.logout, { bubbles: true, composed: true }));
  };

  #render(): void {
    render(
      h(Header, {
        siteTitle: this.getAttribute(HEADER_ATTRIBUTES.siteTitle) ?? '',
        fluid: this.hasAttribute(HEADER_ATTRIBUTES.fluid),
        homeHref: HOME_HREF,
        onHomeClick: this.#onHomeClick,
        returnHref: this.#returnHref ?? '',
        userName: this.getAttribute(HEADER_ATTRIBUTES.userName) ?? '',
        loginHref: this.getAttribute(HEADER_ATTRIBUTES.loginHref) ?? '',
        settingsHref: SETTINGS_HREF,
        onLoginClick: this.#onLoginClick,
        onSettingsClick: this.#onSettingsClick,
        onLogoutClick: this.#onLogoutClick,
      }),
      this.#root,
    );
  }
}

/** Registers `<sdg-header>`. Safe to call more than once, e.g. when a page loads the script twice. */
export function defineSdgHeader(): void {
  if (!customElements.get(HEADER_TAG)) customElements.define(HEADER_TAG, SdgHeaderElement);
}
