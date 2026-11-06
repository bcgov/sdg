import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { NotificationDatabase } from '../../database/database.module.js';
import { runMigrations } from '../../database/run-migrations.js';
import * as schema from '../../database/schema/index.js';
import { createTestApp, type TestApp } from '../../testing/app.js';
import { settleSignals, watchSignals } from '../../testing/signals.js';
import { INBOX_CHANNEL, INBOX_SIGNALS, notifyInboxChanged, type InboxSignals } from './inbox-signals.js';

// Needs a real Postgres whose user may create databases, e.g. the compose one:
// NOTIFICATION_TEST_DATABASE_URL=postgres://portal:portal@localhost:5432/portal pnpm --filter notification-api test
// PGlite has one connection, so delivery to a listener on another connection and its reconnect are proven here (KTD3).
const serverUrl = process.env['NOTIFICATION_TEST_DATABASE_URL'];

describe.skipIf(!serverUrl)('inbox change signals on Postgres (KTD3)', () => {
  const name = `notification_signals_test_${process.pid}_${Date.now()}`;
  const target = new URL(serverUrl ?? 'postgres://unset');
  target.pathname = `/${name}`;

  let t: TestApp;
  let pool: Pool;
  let db: NotificationDatabase;
  let signals: InboxSignals;

  beforeAll(async () => {
    await runMigrations(target.href);
    pool = new Pool({ connectionString: target.href, max: 2 });
    db = drizzle({ client: pool, schema, casing: 'snake_case' });
    // No signals on the database: the app's own listener connects to DATABASE_URL.
    t = await createTestApp({
      env: { DATABASE_URL: target.href },
      database: () => Promise.resolve({ db, close: () => pool.end() }),
    });
    signals = t.app.get<InboxSignals>(INBOX_SIGNALS);
  });

  afterAll(async () => {
    await t?.close();
    const admin = new Client({ connectionString: serverUrl });
    await admin.connect();
    try {
      await admin.query(`drop database if exists "${name}" with (force)`);
    } finally {
      await admin.end();
    }
  });

  const settle = () => settleSignals(signals, db);

  it('delivers a signal committed on a pool connection to the listener on its own connection', async () => {
    const recipientId = randomUUID();
    const watcher = watchSignals(signals, recipientId);

    await db.transaction((tx) => notifyInboxChanged(tx, recipientId));
    await settle();

    expect(watcher.count()).toBe(1);
    watcher.unsubscribe();
  });

  it('sends no signal for a rolled-back write', async () => {
    const recipientId = randomUUID();
    const watcher = watchSignals(signals, recipientId);

    const write = db.transaction(async (tx) => {
      await notifyInboxChanged(tx, recipientId);
      throw new Error('rolled back');
    });
    await expect(write).rejects.toThrow('rolled back');
    await settle();

    expect(watcher.count()).toBe(0);
    watcher.unsubscribe();
  });

  it('sends changed to every local subscriber after the listener reconnects, then keeps listening', async () => {
    const first = watchSignals(signals, randomUUID());
    const second = watchSignals(signals, randomUUID());

    const { rows } = await pool.query<{ terminated: boolean }>(
      `select pg_terminate_backend(pid) as terminated from pg_stat_activity where datname = $1 and query = $2`,
      [name, `LISTEN ${INBOX_CHANNEL}`],
    );
    expect(rows).toEqual([{ terminated: true }]);

    await vi.waitFor(
      () => {
        expect([first.count(), second.count()]).toEqual([1, 1]);
      },
      { timeout: 5_000 },
    );
    await settle();
    expect([first.count(), second.count()]).toEqual([1, 1]);
    first.unsubscribe();
    second.unsubscribe();
  }, 10_000);
});
