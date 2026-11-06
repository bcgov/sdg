import { readEvents } from './event-stream.js';
import { SourceError, TokenUnavailableError, type NotificationsSource } from './source.js';

/** The part of `navigator.locks` the live connection uses. */
export interface LockRequester {
  request(name: string, options: { signal: AbortSignal }, callback: () => Promise<void>): Promise<unknown>;
}

/** The part of `BroadcastChannel` the live connection uses. */
export interface Channel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}

/**
 * `waiting`: another tab holds the stream. `auth-paused`, `token-paused` and `unavailable` are stops: the stream
 * answered 401, the token function returned null, or the stream answered 404 (KTD5, KTD7).
 */
export type LiveStatus =
  | 'stopped'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'auth-paused'
  | 'token-paused'
  | 'unavailable';

export interface LiveConnectionOptions {
  source: Pick<NotificationsSource, 'url' | 'stream'>;
  /** The inbox changed: this tab's stream or another tab's sent `changed`. */
  onChanged: () => void;
  /** A stream opened, here or in another tab; changes may have been missed while none was open. */
  onOpen: () => void;
  onStatus: (status: LiveStatus) => void;
  /** `navigator.locks` by default; null, or missing in the browser, gives each tab its own stream. */
  locks?: LockRequester | null | undefined;
  /** Opens a `BroadcastChannel` by default; null, or missing in the browser, gives each tab its own stream. */
  createChannel?: ((name: string) => Channel) | null | undefined;
}

type Message = { type: 'changed' } | { type: 'open' };

const maxBackoffMs = 30_000;
const jitterMs = 2000;

/** One live stream per browser and source: the tab holding the Web Lock reads it and tells the others (KTD5). */
export class LiveConnection {
  status: LiveStatus = 'stopped';
  readonly #options: LiveConnectionOptions;
  readonly #locks: LockRequester | null;
  readonly #createChannel: ((name: string) => Channel) | null;
  #abort: AbortController | undefined;
  #channel: Channel | undefined;
  /** Failed connects since a stream last opened: the next backoff is 2^attempt seconds. */
  #attempt = 0;

  constructor(options: LiveConnectionOptions) {
    this.#options = options;
    this.#locks = options.locks === undefined ? (globalThis.navigator?.locks ?? null) : options.locks;
    this.#createChannel = options.createChannel === undefined ? defaultChannelFactory() : options.createChannel;
  }

  /** Elects a leader among the tabs, or connects directly where Web Locks or BroadcastChannel are missing. */
  start(): void {
    this.stop();
    const abort = new AbortController();
    this.#abort = abort;
    const name = `sdg-header-notifications ${this.#options.source.url}`;
    const channel = this.#locks ? this.#createChannel?.(name) : undefined;
    if (!this.#locks || !channel) {
      void this.#lead(abort.signal);
      return;
    }
    this.#channel = channel;
    channel.addEventListener('message', this.#onMessage);
    this.#setStatus('waiting');
    this.#locks
      .request(name, { signal: abort.signal }, () => this.#lead(abort.signal))
      .catch((error: unknown) => {
        // Stopping while waiting aborts the request; anything else is a real failure.
        if (!abort.signal.aborted) console.error('sdg-header: notifications lock request failed', error);
      });
  }

  /** Closes the stream and releases the lock, so another tab can take it. */
  stop(): void {
    this.#abort?.abort();
    this.#abort = undefined;
    this.#channel?.close();
    this.#channel = undefined;
    if (this.status !== 'stopped') this.#setStatus('stopped');
  }

  /** Holds the stream until stopped or a stop status; resolving releases the lock. */
  async #lead(signal: AbortSignal): Promise<void> {
    this.#attempt = 0;
    while (!signal.aborted) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- one stream at a time: each connects after the last ends.
        await this.#connect(signal);
        // oxlint-disable-next-line no-await-in-loop -- as above.
        await sleep(Math.random() * jitterMs, signal);
      } catch (error) {
        if (signal.aborted) return;
        const stop = stopStatus(error);
        if (stop) {
          this.#setStatus(stop);
          return;
        }
        // oxlint-disable-next-line no-await-in-loop -- as above.
        await sleep(Math.min(1000 * 2 ** this.#attempt, maxBackoffMs), signal);
        this.#attempt += 1;
      }
    }
  }

  /** Opens the stream and reads it until it ends, announcing the open and each `changed`. */
  async #connect(signal: AbortSignal): Promise<void> {
    this.#setStatus('connecting');
    const body = await this.#options.source.stream(signal);
    this.#attempt = 0;
    this.#setStatus('connected');
    this.#announce({ type: 'open' });
    for await (const event of readEvents(body, signal)) {
      if (event.event === 'changed') this.#announce({ type: 'changed' });
    }
  }

  #announce(message: Message): void {
    this.#channel?.postMessage(message);
    this.#deliver(message.type);
  }

  #deliver(type: unknown): void {
    if (type === 'changed') this.#options.onChanged();
    else if (type === 'open') this.#options.onOpen();
  }

  #setStatus(status: LiveStatus): void {
    this.status = status;
    this.#options.onStatus(status);
  }

  readonly #onMessage = (event: MessageEvent): void => {
    const data: unknown = event.data;
    if (typeof data === 'object' && data !== null && 'type' in data) this.#deliver(data.type);
  };
}

function stopStatus(error: unknown): LiveStatus | undefined {
  if (error instanceof TokenUnavailableError) return 'token-paused';
  if (!(error instanceof SourceError)) return undefined;
  if (error.status === 401) return 'auth-paused';
  if (error.status === 404) return 'unavailable';
  return undefined;
}

function defaultChannelFactory(): ((name: string) => Channel) | null {
  return typeof BroadcastChannel === 'function' ? (name) => new BroadcastChannel(name) : null;
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}
