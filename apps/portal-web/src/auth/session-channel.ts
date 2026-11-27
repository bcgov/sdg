/** The BroadcastChannel portal-web's tabs share session news on (same origin only). */
export const SESSION_CHANNEL = 'portal-web:session';

type SessionMessage =
  /** A tab renewed the session; `idleExpiresAt` is the deadline the renewal answered, as epoch milliseconds. */
  | { type: 'renewed'; idleExpiresAt: number }
  /** A tab signed out, or found the session ended (a 401): the other tabs are signed out too. */
  | { type: 'ended' };

function parseMessage(data: unknown): SessionMessage | undefined {
  if (typeof data !== 'object' || data === null || !('type' in data)) return undefined;
  if (data.type === 'ended') return { type: 'ended' };
  if (data.type === 'renewed' && 'idleExpiresAt' in data && typeof data.idleExpiresAt === 'number') {
    return { type: 'renewed', idleExpiresAt: data.idleExpiresAt };
  }
  return undefined;
}

function post(channel: BroadcastChannel, message: SessionMessage): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel.postMessage has no targetOrigin: a channel only reaches its own origin.
  channel.postMessage(message);
}

export interface SessionChannelListeners {
  /** Another tab renewed the session. */
  onRenewed?: (idleExpiresAt: number) => void;
  /** Another tab signed out or found the session ended. */
  onEnded?: () => void;
}

export interface SessionChannel {
  /** Tells the other tabs this tab renewed the session. */
  announceRenewed: (idleExpiresAt: number) => void;
  close: () => void;
}

/**
 * Opens the tabs' shared session channel, hearing every other tab's news (a tab never hears its own). Without
 * BroadcastChannel (very old browsers) each tab keeps to itself, as before.
 */
export function openSessionChannel({ onRenewed, onEnded }: SessionChannelListeners): SessionChannel {
  if (typeof BroadcastChannel === 'undefined') return { announceRenewed: () => undefined, close: () => undefined };
  const channel = new BroadcastChannel(SESSION_CHANNEL);
  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    const message = parseMessage(event.data);
    if (message?.type === 'renewed') onRenewed?.(message.idleExpiresAt);
    else if (message?.type === 'ended') onEnded?.();
  });
  return {
    announceRenewed: (idleExpiresAt) => post(channel, { type: 'renewed', idleExpiresAt }),
    close: () => channel.close(),
  };
}

/**
 * Tells the other tabs the session has ended (this tab signed out, or a call answered 401). Messages posted before
 * `close` are still delivered, so this is safe right before the page navigates away.
 */
export function announceSessionEnded(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(SESSION_CHANNEL);
  post(channel, { type: 'ended' });
  channel.close();
}
