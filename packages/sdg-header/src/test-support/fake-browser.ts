import type { Channel, LockRequester } from '../notifications/live-connection.js';

interface Waiter {
  callback: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** Exclusive Web Locks shared by every "tab" given the same instance; waiters are granted in request order. */
export class FakeLocks implements LockRequester {
  readonly #held = new Set<string>();
  readonly #queues = new Map<string, Waiter[]>();

  request(name: string, options: { signal: AbortSignal }, callback: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { callback, resolve, reject };
      const queue = this.#queues.get(name) ?? [];
      this.#queues.set(name, [...queue, waiter]);
      options.signal.addEventListener('abort', () => {
        const waiting = this.#queues.get(name) ?? [];
        if (!waiting.includes(waiter)) return;
        this.#queues.set(
          name,
          waiting.filter((other) => other !== waiter),
        );
        reject(new DOMException('The request was aborted', 'AbortError'));
      });
      this.#grant(name);
    });
  }

  /** True while some tab holds the lock. */
  isHeld(name: string): boolean {
    return this.#held.has(name);
  }

  #grant(name: string): void {
    if (this.#held.has(name)) return;
    const [next, ...rest] = this.#queues.get(name) ?? [];
    if (!next) return;
    this.#queues.set(name, rest);
    this.#held.add(name);
    void next
      .callback()
      .then(next.resolve, next.reject)
      .finally(() => {
        this.#held.delete(name);
        this.#grant(name);
      });
  }
}

/** BroadcastChannels that deliver to every other open channel of the same name, like separate tabs. */
export class FakeChannels {
  readonly #open = new Set<FakeChannel>();

  readonly create = (name: string): Channel => {
    const channel = new FakeChannel(name, this.#open);
    this.#open.add(channel);
    return channel;
  };
}

class FakeChannel implements Channel {
  readonly name: string;
  readonly #open: Set<FakeChannel>;
  readonly #listeners = new Set<(event: MessageEvent) => void>();

  constructor(name: string, open: Set<FakeChannel>) {
    this.name = name;
    this.#open = open;
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.#listeners.add(listener);
  }

  postMessage(message: unknown): void {
    for (const other of this.#open) {
      if (other === this || other.name !== this.name) continue;
      // Delivered later, like a message to another tab, and not to a channel closed in the meantime.
      queueMicrotask(() => {
        if (!this.#open.has(other)) return;
        for (const listener of other.#listeners) listener(new MessageEvent('message', { data: message }));
      });
    }
  }

  close(): void {
    this.#open.delete(this);
  }
}
