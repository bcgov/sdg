import { html, LitElement, nothing, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';

import { accountMenuStyles, AccountMenuController } from './account-menu.js';
import { renderAvatar } from './avatar.js';
import { signOutIcon } from './icons.js';
import { bcEmblemViewBox, bcLogo, bcLogoViewBox } from './logo.js';
import { MediaQueryController } from './media-query-controller.js';
import { NavPanelController, navPanelStyles } from './nav-panel.js';
import { NotificationsAnnouncer } from './notifications/bell.js';
import { NotificationsController } from './notifications/notifications-controller.js';
import { NotificationsPopoverController } from './notifications/popover.js';
import { bellStyles, popoverStyles } from './notifications/styles.js';
import { controlStyles, shellStyles } from './styles.js';
import type { AccessTokenFn, HeaderUser, NavItem, SkipLink } from './types.js';

/** The title shown when `header-title` is unset or removed. */
const defaultTitle = 'SDG';

/** The inbox page when `inbox-href` is unset or removed. */
const defaultInboxHref = '/inbox';

/** Below 768px the nav items and account control collapse behind the hamburger. */
const collapsedQuery = '(max-width: 767.98px)';

/** A plain primary-button click; modified clicks (new tab, download…) stay with the browser. */
const isPlainClick = (event: MouseEvent): boolean =>
  !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * The B.C. government header: logo, title (`SDG` by default), skip links, nav items, the notifications bell and the
 * account control, inline on wide screens and behind a hamburger panel on narrow ones. Every input is optional.
 */
export class SdgHeader extends LitElement {
  static override readonly properties: PropertyDeclarations = {
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
    notificationsUrl: { attribute: 'notifications-url' },
    inboxHref: {
      attribute: 'inbox-href',
      converter: { fromAttribute: (value: string | null) => value ?? defaultInboxHref },
    },
    accessTokenFn: { attribute: false },
    notificationsChangedFn: { attribute: false },
    failedAvatarSrc: { state: true },
  };

  static override readonly styles: CSSResultGroup = [
    shellStyles,
    controlStyles,
    accountMenuStyles,
    navPanelStyles,
    bellStyles,
    popoverStyles,
  ];

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
  /** The notifications source (a relay on the host's origin, or notification-api's `/api/v1/me`); the bell needs it and a user. */
  declare notificationsUrl: string | undefined;
  /** The host's inbox page: "View all" opens it and each notification opens `${inboxHref}/${notificationId}`. Defaults to `/inbox`. */
  declare inboxHref: string;
  /** Direct mode: supplies notification-api's bearer token. Unset, requests go to the relay with the host's cookies. */
  declare accessTokenFn: AccessTokenFn | undefined;
  /** Called when the user's inbox changed, so a host page can refetch without its own live connection. */
  declare notificationsChangedFn: (() => void) | undefined;
  declare protected failedAvatarSrc: string | null;

  readonly #collapsed = new MediaQueryController(this, collapsedQuery);
  readonly #accountMenu = new AccountMenuController(this);
  readonly #navPanel = new NavPanelController(this);
  readonly #notifications = new NotificationsController(this);
  readonly #announcer = new NotificationsAnnouncer(this, this.#notifications);
  readonly #popover = new NotificationsPopoverController(this, this.#notifications, this.#announcer);

  constructor() {
    super();
    this.headerTitle = defaultTitle;
    this.logoHref = '/';
    this.inboxHref = defaultInboxHref;
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
    this.#notifications.configure({
      url: this.notificationsUrl,
      signedIn: Boolean(this.user),
      accessTokenFn: this.accessTokenFn,
      notificationsChangedFn: this.notificationsChangedFn,
    });
    if (!this.#showsBell()) void this.#popover.close();
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
      ${this.#showsBell() ? this.#announcer.render() : nothing}
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
    const bell = this.#renderBell();
    if (this.#collapsed.matches) {
      const menu = this.#navPanel.render({
        menuLabel: this.menuLabel,
        profile: this.#renderPanelProfile(),
        navList,
        footer: this.#renderPanelFooter(),
      });
      // The bell stays in the bar beside the menu button, so the count stays visible.
      return bell === nothing ? menu : html`<div class="bar-actions">${bell}${menu}</div>`;
    }
    return html`<div class="nav-area">${navList}${bell}${this.#renderAccount()}</div>`;
  }

  /** Notifications run with a source and a user, and the bell shows unless the source has none (404). */
  #showsBell(): boolean {
    return Boolean(this.notificationsUrl && this.user) && this.#notifications.status !== 'unavailable';
  }

  #renderBell(): TemplateResult | typeof nothing {
    if (!this.#showsBell()) return nothing;
    return this.#popover.render({
      collapsed: this.#collapsed.matches,
      inboxHref: this.inboxHref,
      navigateFn: this.navigateFn,
      onLinkClick: this.#onNavigateClick,
    });
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
