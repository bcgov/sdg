import type { ReactiveController, ReactiveControllerHost } from 'lit';

import type { AccessTokenFn, InboxItem } from '../types.js';
import { LiveConnection, type Channel, type LiveStatus, type LockRequester } from './live-connection.js';
import { NotificationsSource, SourceError, TokenUnavailableError, type FetchFn } from './source.js';

/** `unavailable`: the source has no notifications for this user (404), so the bell hides. */
export type NotificationsStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';

/** The element's notification inputs. Notifications run only with a `url` and a signed-in user. */
export interface NotificationsConfig {
  url: string | null | undefined;
  signedIn: boolean;
  accessTokenFn?: AccessTokenFn | undefined;
  notificationsChangedFn?: (() => void) | undefined;
}

/** Browser features the controller uses; each defaults to the global. */
export interface NotificationsEnvironment {
  fetch?: FetchFn;
  locks?: LockRequester | null;
  createChannel?: ((name: string) => Channel) | null;
}

/** Refetch triggers (changed, open, focus, visibility) within this window cause one refetch. */
export const refetchDebounceMs = 250;

interface Session {
  source: NotificationsSource;
  live: LiveConnection;
}

/**
 * The header's notifications: the unread count and newest items from the configured source, kept current by the live
 * connection and refetched on focus (KTD1, KTD5). The host calls `configure` whenever its inputs change.
 */
export class NotificationsController implements ReactiveController {
  unread = 0;
  items: InboxItem[] = [];
  status: NotificationsStatus = 'idle';
  readonly #host: ReactiveControllerHost;
  readonly #environment: NotificationsEnvironment;
  #config: NotificationsConfig = { url: undefined, signedIn: false };
  #key = '';
  #connected = false;
  #session: Session | undefined;
  /** Each load and mark takes a number; a load that finishes after a newer one started is dropped. */
  #generation = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** A `changed` arrived and the host has not been told since. */
  #unreportedChange = false;
  /** The token function returned null: requests wait for the user's next pointer or key event (KTD7). */
  #tokenPaused = false;
  /** The source answered 401: background loads and the stream wait for the signed-in state to change (KTD5). */
  #authPaused = false;

  constructor(host: ReactiveControllerHost, environment: NotificationsEnvironment = {}) {
    this.#host = host;
    this.#environment = environment;
    host.addController(this);
  }

  /** Applies the element's inputs; a new source, mode or signed-in state starts over (state diagram, KTD5). */
  configure(config: NotificationsConfig): void {
    this.#config = config;
    const key = config.url && config.signedIn ? `${config.accessTokenFn ? 'direct' : 'relay'} ${config.url}` : '';
    if (key === this.#key) return;
    this.#key = key;
    if (this.#connected) this.#restart();
  }

  hostConnected(): void {
    this.#connected = true;
    this.#restart();
  }

  hostDisconnected(): void {
    this.#connected = false;
    this.#end();
  }

  /** Loads the count and items now, as a user action (e.g. retry after an error). */
  refresh(): Promise<void> {
    return this.#refetch(false);
  }

  /** Marks one item read. Rejects, leaving the state as it was, when the source fails. */
  async markRead(itemId: string): Promise<void> {
    const updated = await this.#act((source) => source.markRead(itemId));
    const before = this.items.find(({ id }) => id === itemId);
    if (before && before.readAt === null && updated.readAt !== null) this.unread = Math.max(0, this.unread - 1);
    this.items = this.items.map((existing) => (existing.id === itemId ? { ...existing, ...updated } : existing));
    this.#changedLocally();
  }

  /** Marks every unread item read (R20). Rejects, leaving the state as it was, when the source fails. */
  async markAllRead(): Promise<void> {
    await this.#act((source) => source.markAllRead());
    const readAt = new Date().toISOString();
    this.unread = 0;
    this.items = this.items.map((existing) => (existing.readAt === null ? { ...existing, readAt } : existing));
    this.#changedLocally();
  }

  #restart(): void {
    this.#end();
    this.unread = 0;
    this.items = [];
    this.status = this.#key ? 'loading' : 'idle';
    this.#host.requestUpdate();
    if (this.#key) this.#start();
  }

  #start(): void {
    const { url, accessTokenFn } = this.#config;
    if (!url) return;
    let opened = 0;
    const source = new NotificationsSource({
      url,
      // Read at call time, so a host passing a new function each render does not restart the stream.
      accessTokenFn: accessTokenFn ? (request) => this.#config.accessTokenFn?.(request) ?? null : undefined,
      fetch: this.#environment.fetch,
    });
    const live = new LiveConnection({
      source,
      onChanged: () => this.#schedule(true),
      // A reopened stream may have missed changes, so the host hears about it like a change (R26, R33).
      onOpen: () => this.#schedule(opened++ > 0),
      onStatus: (status) => this.#onLiveStatus(live, status),
      locks: this.#environment.locks,
      createChannel: this.#environment.createChannel,
    });
    this.#session = { source, live };
    window.addEventListener('focus', this.#onFocus);
    document.addEventListener('visibilitychange', this.#onVisibilityChange);
    live.start();
    void this.#refetch(true);
  }

  #end(): void {
    this.#session?.live.stop();
    this.#session = undefined;
    this.#generation += 1;
    clearTimeout(this.#timer);
    this.#unreportedChange = false;
    this.#authPaused = false;
    this.#setTokenPaused(false);
    window.removeEventListener('focus', this.#onFocus);
    document.removeEventListener('visibilitychange', this.#onVisibilityChange);
  }

  #schedule(change: boolean): void {
    if (change) this.#unreportedChange = true;
    if (this.#halted) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#refetch(true), refetchDebounceMs);
  }

  async #refetch(background: boolean): Promise<void> {
    const session = this.#session;
    if (!session || this.status === 'unavailable') return;
    this.#generation += 1;
    const generation = this.#generation;
    try {
      const [unread, items] = await Promise.all([
        session.source.unreadCount(background),
        session.source.latest(background),
      ]);
      if (generation !== this.#generation) return;
      Object.assign(this, { unread, items, status: 'ready' });
      this.#host.requestUpdate();
    } catch (error) {
      if (generation === this.#generation) this.#onLoadError(session, error);
      return;
    }
    if (this.#unreportedChange) {
      this.#unreportedChange = false;
      this.#config.notificationsChangedFn?.();
    }
  }

  /** Runs a user action against the source; a newer state wins over any load still in flight. */
  async #act<T>(action: (source: NotificationsSource) => Promise<T>): Promise<T> {
    const session = this.#session;
    if (!session) throw new Error('sdg-header: notifications are not configured');
    try {
      const result = await action(session.source);
      this.#generation += 1;
      return result;
    } catch (error) {
      if (error instanceof SourceError && error.status === 401) this.#signedOut(session.live);
      throw error;
    }
  }

  #changedLocally(): void {
    this.#host.requestUpdate();
    this.#config.notificationsChangedFn?.();
  }

  #onLoadError(session: Session, error: unknown): void {
    if (error instanceof TokenUnavailableError) {
      session.live.stop();
      this.#setTokenPaused(true);
      return;
    }
    const status = error instanceof SourceError ? error.status : undefined;
    if (status === 401) this.#signedOut(session.live);
    if (status === 404) session.live.stop();
    this.status = status === 404 ? 'unavailable' : 'error';
    this.#host.requestUpdate();
  }

  #onLiveStatus(live: LiveConnection, status: LiveStatus): void {
    if (this.#session?.live !== live) return;
    if (status === 'auth-paused') this.#signedOut(live);
    if (status === 'token-paused') this.#setTokenPaused(true);
    if (status === 'unavailable') {
      this.#generation += 1;
      this.status = 'unavailable';
      this.#host.requestUpdate();
    }
  }

  /** A 401: stop the stream until the signed-in state changes, and let the host refresh it (R33). */
  #signedOut(live: LiveConnection): void {
    if (this.#authPaused) return;
    this.#authPaused = true;
    clearTimeout(this.#timer);
    live.stop();
    this.#config.notificationsChangedFn?.();
  }

  #setTokenPaused(paused: boolean): void {
    if (paused === this.#tokenPaused) return;
    this.#tokenPaused = paused;
    for (const type of ['pointerdown', 'keydown']) {
      if (paused) document.addEventListener(type, this.#onUserActivity, { capture: true });
      else document.removeEventListener(type, this.#onUserActivity, { capture: true });
    }
  }

  /** Retries as a user action, and reconnects the stream once that got a token. */
  readonly #onUserActivity = (): void => {
    this.#setTokenPaused(false);
    void this.#resume();
  };

  async #resume(): Promise<void> {
    const session = this.#session;
    if (!session) return;
    await this.#refetch(false);
    if (this.#session === session && !this.#halted) session.live.start();
  }

  /** Paused for a token or a sign-in, or the source has no notifications: no loads and no stream. */
  get #halted(): boolean {
    return this.#tokenPaused || this.#authPaused || this.status === 'unavailable';
  }

  readonly #onFocus = (): void => this.#schedule(false);

  readonly #onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') this.#schedule(false);
  };
}
