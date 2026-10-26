import { html, LitElement, nothing, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';

import { accountMenuStyles, AccountMenuController } from './account-menu.js';
import { renderAvatar } from './avatar.js';
import { signOutIcon } from './icons.js';
import { bcEmblemViewBox, bcLogo, bcLogoViewBox } from './logo.js';
import { MediaQueryController } from './media-query-controller.js';
import { NavPanelController, navPanelStyles } from './nav-panel.js';
import { controlStyles, shellStyles } from './styles.js';
import type { HeaderUser, NavItem, SkipLink } from './types.js';

/** The title shown when `header-title` is unset or removed. */
const defaultTitle = 'SDG';

/** Below 768px the nav items and account control collapse behind the hamburger. */
const collapsedQuery = '(max-width: 767.98px)';

/** A plain primary-button click; modified clicks (new tab, download…) stay with the browser. */
const isPlainClick = (event: MouseEvent): boolean =>
  !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * The B.C. government header: logo, title (`SDG` by default), skip links, nav items and the account control, inline on wide
 * screens and behind a hamburger panel on narrow ones. Every input is optional.
 */
export class SdgHeader extends LitElement {
  static override properties: PropertyDeclarations = {
    // Removing the attribute (e.g. React dropping the prop) restores the default instead of hiding the title.
    headerTitle: {
      attribute: 'header-title',
      converter: { fromAttribute: (value: string | null) => value ?? defaultTitle },
    },
    logoHref: { attribute: 'logo-href' },
    signInHref: { attribute: 'sign-in-href' },
    navLabel: { attribute: 'nav-label' },
    menuLabel: { attribute: 'menu-label' },
    skipLinks: { attribute: false },
    navItems: { attribute: false },
    user: { attribute: false },
    signOutFn: { attribute: false },
    navigateFn: { attribute: false },
    failedAvatarSrc: { state: true },
  };

  static override styles: CSSResultGroup = [shellStyles, controlStyles, accountMenuStyles, navPanelStyles];

  /** Text after the divider. Defaults to `SDG`; an empty string hides the divider and title. */
  declare headerTitle: string;
  /** Where the logo links. Defaults to `/`. */
  declare logoHref: string;
  /** The Sign in link, shown when set and there is no user. */
  declare signInHref: string | undefined;
  /** Accessible name of the `<nav>`. Defaults to `Main`. */
  declare navLabel: string;
  /** Accessible name of the hamburger button. Defaults to `Menu`. */
  declare menuLabel: string;
  declare skipLinks: readonly SkipLink[];
  declare navItems: readonly NavItem[];
  declare user: HeaderUser | null;
  /** Signs the user out; Log out is shown only when set. */
  declare signOutFn: (() => void) | undefined;
  /** Client-side navigation: when set, plain clicks on nav items and the logo call it instead of loading the page. */
  declare navigateFn: ((href: string) => void) | undefined;
  declare protected failedAvatarSrc: string | null;

  readonly #collapsed = new MediaQueryController(this, collapsedQuery);
  readonly #accountMenu = new AccountMenuController(this);
  readonly #navPanel = new NavPanelController(this);

  constructor() {
    super();
    this.headerTitle = defaultTitle;
    this.logoHref = '/';
    this.navLabel = 'Main';
    this.menuLabel = 'Menu';
    this.skipLinks = [];
    this.navItems = [];
    this.user = null;
    this.failedAvatarSrc = null;
  }

  protected override willUpdate(): void {
    // Only one layout is on screen: close whichever one just went away, and the account menu once signed out.
    if (!this.#collapsed.matches) void this.#navPanel.close();
    if (this.#collapsed.matches || !this.user) void this.#accountMenu.close();
  }

  protected override render(): TemplateResult {
    return html`<header class="bcds-header">
      <div class="bcds-header--container">
        ${this.#renderSkipLinks()}
        <a class="logo" href=${this.logoHref} title="Government of British Columbia" @click=${this.#onNavigateClick}>
          ${this.#renderLogo()}
        </a>
        ${
          this.headerTitle
            ? html`<div class="bcds-header--line"></div>
                <span class="bcds-header--title">${this.headerTitle}</span>`
            : nothing
        }
        ${this.#renderNavArea()}
      </div>
    </header>`;
  }

  #renderLogo(): TemplateResult {
    // Collapsed, the logo is cropped to its emblem (the wordmark falls outside the viewBox) so the title and hamburger fit.
    return this.#collapsed.matches
      ? html`<svg id="bcgov-emblem-header" class="emblem" xmlns="http://www.w3.org/2000/svg" viewBox=${bcEmblemViewBox}>
          ${bcLogo}
        </svg>`
      : html`<svg id="bcgov-logo-header" xmlns="http://www.w3.org/2000/svg" viewBox=${bcLogoViewBox}>${bcLogo}</svg>`;
  }

  #renderSkipLinks(): TemplateResult | typeof nothing {
    if (this.skipLinks.length === 0) return nothing;
    return html`<ul class="bcds-header--skiplinks">
      ${this.skipLinks.map(({ label, href }) => html`<li><a href=${href}>${label}</a></li>`)}
    </ul>`;
  }

  #renderNavArea(): TemplateResult | typeof nothing {
    const navList = this.#renderNavList();
    const hasAccount = Boolean(this.user ?? this.signInHref);
    if (navList === nothing && !hasAccount) return nothing;
    if (this.#collapsed.matches) {
      return this.#navPanel.render({
        menuLabel: this.menuLabel,
        profile: this.#renderPanelProfile(),
        navList,
        footer: this.#renderPanelFooter(),
      });
    }
    return html`<div class="nav-area">${navList}${this.#renderAccount()}</div>`;
  }

  #renderNavList(): TemplateResult | typeof nothing {
    if (this.navItems.length === 0) return nothing;
    return html`<nav aria-label=${this.navLabel}>
      <ul class="nav-list">
        ${this.navItems.map(
          ({ label, href, current }) =>
            html`<li>
              <a
                class="nav-link"
                href=${href}
                aria-current=${current ? 'page' : nothing}
                @click=${this.#onNavigateClick}
                >${label}</a
              >
            </li>`,
        )}
      </ul>
    </nav>`;
  }

  #renderSignIn(): TemplateResult | typeof nothing {
    // A real link: signing in is a full-page navigation.
    return this.signInHref ? html`<a class="nav-link" href=${this.signInHref}>Sign in</a>` : nothing;
  }

  #renderAccount(): TemplateResult | typeof nothing {
    if (!this.user) return this.#renderSignIn();
    return this.#accountMenu.render({ user: this.user, signOutFn: this.signOutFn, avatar: this.#avatarOptions() });
  }

  #renderPanelProfile(): TemplateResult | typeof nothing {
    const { user } = this;
    if (!user) return nothing;
    return html`<div class="profile">
      ${renderAvatar(user, { size: 'medium', ...this.#avatarOptions() })}
      <span class="identity">
        <span class="name">${user.name}</span>
        ${user.email ? html`<span class="email">${user.email}</span>` : nothing}
      </span>
    </div>`;
  }

  #renderPanelFooter(): TemplateResult | typeof nothing {
    const { user, signOutFn } = this;
    if (!user) return this.#renderSignIn();
    if (!signOutFn) return nothing;
    return html`<button type="button" class="button danger" @click=${() => signOutFn()}>
      ${signOutIcon}<span>Log out</span>
    </button>`;
  }

  #avatarOptions(): { failedSrc: string | null; onImageError: (src: string) => void } {
    return { failedSrc: this.failedAvatarSrc, onImageError: (src) => (this.failedAvatarSrc = src) };
  }

  readonly #onNavigateClick = (event: MouseEvent): void => {
    const navigateFn = this.navigateFn;
    const link = event.currentTarget;
    if (!navigateFn || !(link instanceof HTMLAnchorElement) || !isPlainClick(event)) return;
    event.preventDefault();
    navigateFn(link.getAttribute('href') ?? '');
  };
}
