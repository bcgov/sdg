import { randomUUID } from 'node:crypto';

import type { NotificationDatabase } from '../database/database.module.js';
import { notifyInboxChanged, type InboxSignals } from '../inbox/signals/inbox-signals.js';

export interface SignalWatcher {
  /** How many `changed` signals the subscriber has received. */
  count: () => number;
  unsubscribe: () => void;
}

/** Subscribes to one recipient's signals and counts them. */
export function watchSignals(signals: InboxSignals, recipientId: string): SignalWatcher {
  let received = 0;
  const unsubscribe = signals.subscribe(recipientId, () => {
    received += 1;
  });
  return { count: () => received, unsubscribe };
}

/**
 * Commits a signal for a recipient nobody else uses and resolves once it arrives. Notifications reach a listener in
 * commit order, so every signal committed before it has been delivered by then.
 */
export async function settleSignals(signals: InboxSignals, db: NotificationDatabase): Promise<void> {
  const marker = randomUUID();
  const arrived = new Promise<void>((resolve) => {
    const unsubscribe = signals.subscribe(marker, () => {
      unsubscribe();
      resolve();
    });
  });
  await db.transaction((tx) => notifyInboxChanged(tx, marker));
  await arrived;
}
