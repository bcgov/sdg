import { html, nothing, type ReactiveController, type ReactiveControllerHost, type TemplateResult } from 'lit';

import { bellIcon } from '../icons.js';
import type { NotificationsController } from './notifications-controller.js';

/** Count changes within this window are announced once, with the latest count (KTD13). */
const announceWindowMs = 1500;

/** The badge text: hidden (null) at zero, the count up to 99, then "99+" (R2). */
export const badgeText = (unread: number): string | null => {
  if (unread <= 0) return null;
  return unread > 99 ? '99+' : String(unread);
};

const countMessage = (unread: number): string => {
  if (unread === 0) return 'No unread notifications';
  return `${unread} unread notification${unread === 1 ? '' : 's'}`;
};

export interface BellOptions {
  unread: number;
  expanded: boolean;
  /** The id of the popover the bell controls, set while it is open. */
  controls: string;
  onClick: (event: MouseEvent) => void;
}

/** The bell button and its badge; the accessible name carries the real count, the badge is only visual. */
export function renderBell({ unread, expanded, controls, onClick }: BellOptions): TemplateResult {
  const text = badgeText(unread);
  return html`<button
    type="button"
    class="button icon-only bell-trigger"
    aria-label="Notifications, ${unread} unread"
    aria-haspopup="dialog"
    aria-expanded=${expanded ? 'true' : 'false'}
    aria-controls=${expanded ? controls : nothing}
    @click=${onClick}
  >
    ${bellIcon}${text === null ? nothing : html`<span class="badge" aria-hidden="true">${text}</span>`}
  </button>`;
}

/**
 * The one polite live region for notifications (KTD13). It stays silent on the first load after each sign-in, then
 * announces count changes at most once per window; `announce` speaks a message, such as a failure, at once.
 */
export class NotificationsAnnouncer implements ReactiveController {
  message = '';
  readonly #host: ReactiveControllerHost;
  readonly #notifications: NotificationsController;
  /** The count last loaded or announced; undefined until the first load after a (re)start. */
  #spoken: number | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(host: ReactiveControllerHost, notifications: NotificationsController) {
    this.#host = host;
    this.#notifications = notifications;
    host.addController(this);
  }

  hostUpdate(): void {
    const { status, unread } = this.#notifications;
    if (status === 'idle' || status === 'loading' || status === 'unavailable') {
      this.#reset();
      return;
    }
    if (status !== 'ready') return;
    if (this.#spoken === undefined) this.#spoken = unread;
    else if (unread !== this.#spoken) this.#timer ??= setTimeout(this.#speakCount, announceWindowMs);
  }

  hostDisconnected(): void {
    this.#reset();
  }

  announce(message: string): void {
    this.message = message;
    this.#host.requestUpdate();
  }

  render(): TemplateResult {
    return html`<span class="visually-hidden" aria-live="polite">${this.message}</span>`;
  }

  #reset(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#spoken = undefined;
    this.message = '';
  }

  readonly #speakCount = (): void => {
    this.#timer = undefined;
    const { status, unread } = this.#notifications;
    if (status !== 'ready' || unread === this.#spoken) return;
    this.#spoken = unread;
    this.announce(countMessage(unread));
  };
}
