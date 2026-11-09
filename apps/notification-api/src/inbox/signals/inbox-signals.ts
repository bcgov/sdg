import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { DbOrTx } from '../../database/database.module.js';
import { describeError } from '../../logging/describe-error.js';

const logger = new Logger('InboxSignals');

/**
 * KTD3: every inbox write (the planner's insert, `mark`, read-all) sends one NOTIFY on this channel, with the
 * recipient id as payload, inside its own transaction. Postgres delivers it only when that transaction commits.
 */
export const INBOX_CHANNEL = 'inbox_changed';

/** Injects the api role's `InboxSignals`. */
export const INBOX_SIGNALS = Symbol('INBOX_SIGNALS');

/** Called with no arguments when the recipient's inbox may have changed: the receiver refetches. */
export type InboxChangedCallback = () => void;

/** This instance's view of the inbox change signals, for the recipients with an open stream here. */
export interface InboxSignals {
  /** Calls `callback` on each change to the recipient's inbox, and after the listener reconnects. */
  subscribe(recipientId: string, callback: InboxChangedCallback): () => void;
}

/**
 * Signals that the recipient's inbox changed, in the caller's transaction. Call it once per transaction, never per
 * row: NOTIFY takes a database-wide lock at commit.
 */
export async function notifyInboxChanged(tx: DbOrTx, recipientId: string): Promise<void> {
  await tx.execute(sql`select pg_notify(${INBOX_CHANNEL}, ${recipientId})`);
}

/** The in-memory map of recipient to local subscribers that each implementation dispatches to. */
export class InboxSubscribers implements InboxSignals {
  private readonly byRecipient = new Map<string, Set<InboxChangedCallback>>();

  subscribe(recipientId: string, callback: InboxChangedCallback): () => void {
    // A fresh function per subscription, so one callback subscribed twice is two subscribers.
    const entry: InboxChangedCallback = () => callback();
    const callbacks = this.byRecipient.get(recipientId) ?? new Set();
    callbacks.add(entry);
    this.byRecipient.set(recipientId, callbacks);
    return () => {
      callbacks.delete(entry);
      if (callbacks.size === 0 && this.byRecipient.get(recipientId) === callbacks) this.byRecipient.delete(recipientId);
    };
  }

  /** Delivers one signal to the recipient's subscribers. One that throws is logged and skips none of the others. */
  dispatch(recipientId: string): void {
    for (const callback of this.byRecipient.get(recipientId) ?? []) {
      try {
        callback();
      } catch (error) {
        logger.error({ msg: 'An inbox signal subscriber failed', recipientId, error: describeError(error) });
      }
    }
  }

  /** Delivers `changed` to every local subscriber, for when signals may have been missed. */
  broadcast(): void {
    for (const recipientId of this.byRecipient.keys()) this.dispatch(recipientId);
  }
}
