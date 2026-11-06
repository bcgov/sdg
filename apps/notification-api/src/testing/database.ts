import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import type { NotificationDatabase } from '../database/database.module.js';
import { migrationsFolder } from '../database/run-migrations.js';
import * as schema from '../database/schema/index.js';
import type { InboxSignals } from '../inbox/signals/inbox-signals.js';
import { PgliteInboxSignals } from '../inbox/signals/pglite-inbox-signals.js';

export interface TestDatabase {
  /** Typed as the production database: PGlite and node-postgres share Drizzle's Postgres query API. */
  db: NotificationDatabase;
  /** Inbox change signals listening on this database; without them the app's own listener uses DATABASE_URL. */
  signals?: InboxSignals;
  close: () => Promise<void>;
}

/**
 * In-process Postgres (PGlite) with the committed drizzle/ migrations applied, and inbox change signals listening on
 * it. Create one per test file.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle({ client, schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder });
  const signals = await PgliteInboxSignals.listen(client);
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- PGlite and node-postgres share Drizzle's pg query API; only $client differs.
    db: db as unknown as NotificationDatabase,
    signals,
    close: async () => {
      await signals.close();
      await client.close();
    },
  };
}
