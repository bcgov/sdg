import type { PGlite } from '@electric-sql/pglite';

import { INBOX_CHANNEL, InboxSubscribers } from './inbox-signals.js';

/**
 * The test implementation (KTD3): LISTENs on the test database's own PGlite instance, so tests go through the real
 * `pg_notify` and its commit-only delivery. PGlite has one connection and never reconnects.
 */
export class PgliteInboxSignals extends InboxSubscribers {
  private unlisten: (() => Promise<void>) | null = null;

  /** Starts listening on the instance and resolves once LISTEN has run. */
  static async listen(client: PGlite): Promise<PgliteInboxSignals> {
    const signals = new PgliteInboxSignals();
    signals.unlisten = await client.listen(INBOX_CHANNEL, (recipientId) => signals.dispatch(recipientId));
    return signals;
  }

  async close(): Promise<void> {
    await this.unlisten?.();
    this.unlisten = null;
  }
}
