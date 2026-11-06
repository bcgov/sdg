import { html, nothing, type LitElement, type ReactiveController, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import type { InboxItem } from '../types.js';
import { renderBell, type NotificationsAnnouncer } from './bell.js';
import type { NotificationsController } from './notifications-controller.js';
import { relativeTime } from './relative-time.js';

export interface PopoverOptions {
  /** Narrow layout: the bell sits in the bar beside the menu button and the panel spans the header's gutters. */
  collapsed: boolean;
  /** The host's inbox page; each item opens `${inboxHref}/${notificationId}`. */
  inboxHref: string;
  /** Client-side navigation; without it, opening an item assigns the location. */
  navigateFn: ((href: string) => void) | undefined;
  /** The host's link click handler, which routes plain clicks through `navigateFn`. */
  onLinkClick: (event: MouseEvent) => void;
}

const panelId = 'notifications-panel';
const markAllFailed = "Couldn't mark all as read.";

/**
 * The bell and the popover it opens (KTD1): a non-modal dialog anchored to the bell with the newest items, "Mark all as
 * read" and "View all". Like the account menu, it closes on Escape (returning focus to the bell) and on a pointer press
 * outside, found with `composedPath` so the shadow DOM boundary doesn't matter.
 */
export class NotificationsPopoverController implements ReactiveController {
  isOpen = false;
  readonly #host: LitElement;
  readonly #notifications: NotificationsController;
  readonly #announcer: NotificationsAnnouncer;
  #markAllError = false;

  constructor(host: LitElement, notifications: NotificationsController, announcer: NotificationsAnnouncer) {
    this.#host = host;
    this.#notifications = notifications;
    this.#announcer = announcer;
    host.addController(this);
  }

  hostDisconnected(): void {
    this.isOpen = false;
    document.removeEventListener('pointerdown', this.#onDocumentPointerDown);
  }

  render(options: PopoverOptions): TemplateResult {
    const bell = renderBell({
      unread: this.#notifications.unread,
      expanded: this.isOpen,
      controls: panelId,
      onClick: this.#onBellClick,
    });
    return html`<div class="notifications${options.collapsed ? ' collapsed' : ''}" @keydown=${this.#onKeyDown}>
      ${bell}${this.isOpen ? this.#renderPanel(options) : nothing}
    </div>`;
  }

  /** Closes the popover; `focusBell` returns focus to the bell. */
  async close(focusBell = false): Promise<void> {
    if (!this.isOpen) return;
    this.isOpen = false;
    document.removeEventListener('pointerdown', this.#onDocumentPointerDown);
    this.#host.requestUpdate();
    await this.#host.updateComplete;
    if (focusBell) this.#query('.bell-trigger')?.focus();
  }

  #renderPanel(options: PopoverOptions): TemplateResult {
    const nothingUnread = this.#notifications.unread === 0;
    return html`<div
      id=${panelId}
      class="notifications-panel"
      role="dialog"
      aria-labelledby="notifications-title"
      tabindex="-1"
    >
      <div class="notifications-header">
        <h2 id="notifications-title">Notifications</h2>
        <button
          type="button"
          class="button"
          aria-disabled=${nothingUnread ? 'true' : 'false'}
          aria-describedby=${this.#markAllError ? 'mark-all-error' : nothing}
          @click=${this.#onMarkAllClick}
        >
          Mark all as read
        </button>
        ${this.#markAllError ? html`<span id="mark-all-error" class="inline-error">${markAllFailed}</span>` : nothing}
      </div>
      ${this.#renderBody(options)}
      <div class="notifications-footer">
        <a
          class="nav-link"
          href=${options.inboxHref}
          @click=${(event: MouseEvent) => this.#onViewAllClick(event, options)}
          >View all</a
        >
      </div>
    </div>`;
  }

  #renderBody(options: PopoverOptions): TemplateResult {
    const { status, items } = this.#notifications;
    if (status === 'error') {
      return html`<div>
        <p class="panel-state" tabindex="-1">Couldn't load notifications.</p>
        <button type="button" class="button" @click=${() => void this.#notifications.refresh()}>Try again</button>
      </div>`;
    }
    if (items.length === 0) {
      const text = status === 'ready' ? 'No notifications yet' : 'Loading notifications…';
      return html`<p class="panel-state" tabindex="-1">${text}</p>`;
    }
    // Keyed rows: an arrival at the top moves the existing rows' DOM, so focus stays on the item it was on.
    return html`<ul class="notification-list">
      ${repeat(
        items,
        ({ id }) => id,
        (item) => html`<li>${this.#renderItem(item, options)}</li>`,
      )}
    </ul>`;
  }

  #renderItem(item: InboxItem, options: PopoverOptions): TemplateResult {
    const unread = item.readAt === null;
    return html`<button
      type="button"
      class="notification-item${unread ? '' : ' read'}"
      @click=${() => this.#activate(item, options)}
    >
      ${unread ? html`<span class="unread-dot" aria-hidden="true"></span><span class="visually-hidden">Unread</span>` : nothing}
      <span class="item-text">
        <span class="item-title">${item.title ?? 'Notification'}</span>
        ${item.excerpt ? html`<span class="item-excerpt">${item.excerpt}</span>` : nothing}
        <time class="item-time" datetime=${item.createdAt}>${relativeTime(item.createdAt)}</time>
      </span>
    </button>`;
  }

  async #open(): Promise<void> {
    this.isOpen = true;
    this.#markAllError = false;
    document.addEventListener('pointerdown', this.#onDocumentPointerDown);
    this.#host.requestUpdate();
    await this.#host.updateComplete;
    (this.#query('.notification-item') ?? this.#query('.panel-state') ?? this.#query(`#${panelId}`))?.focus();
  }

  /** Marks the item read without waiting (its page marks it read too, R18) and opens its page (R5). */
  #activate(item: InboxItem, { inboxHref, navigateFn }: PopoverOptions): void {
    if (item.readAt === null) {
      this.#notifications.markRead(item.id).catch((error: unknown) => {
        console.error('sdg-header: marking the notification read failed', error);
      });
    }
    void this.close();
    const href = `${inboxHref.replace(/\/+$/u, '')}/${encodeURIComponent(item.notificationId)}`;
    if (navigateFn) navigateFn(href);
    else window.location.assign(href);
  }

  async #markAll(): Promise<void> {
    try {
      await this.#notifications.markAllRead();
    } catch (error) {
      console.error('sdg-header: marking all notifications read failed', error);
      this.#markAllError = true;
      this.#announcer.announce(markAllFailed);
      return;
    }
    this.#markAllError = false;
    this.#host.requestUpdate();
    await this.#host.updateComplete;
    this.#query('.notification-item')?.focus();
  }

  #query(selector: string): HTMLElement | null {
    return this.#host.renderRoot.querySelector<HTMLElement>(selector);
  }

  readonly #onBellClick = (): void => {
    if (this.isOpen) void this.close();
    else void this.#open();
  };

  // aria-disabled keeps the button in the tab order, so it ignores presses itself.
  readonly #onMarkAllClick = (): void => {
    if (this.#notifications.unread > 0) void this.#markAll();
  };

  #onViewAllClick(event: MouseEvent, { onLinkClick }: PopoverOptions): void {
    onLinkClick(event);
    void this.close();
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.isOpen) return;
    event.preventDefault();
    void this.close(true);
  };

  readonly #onDocumentPointerDown = (event: PointerEvent): void => {
    const root = this.#query('.notifications');
    if (root && event.composedPath().includes(root)) return;
    const hadFocus = root?.contains(this.#host.shadowRoot?.activeElement ?? null) ?? false;
    void this.close(hadFocus);
  };
}
