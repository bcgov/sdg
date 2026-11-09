import * as schema from '@repo/notification-database/schema';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ExpanderService } from '../delivery/expander.js';
import { PlannerService } from '../delivery/planner.js';
import { createPostgresTestDatabase } from '../testing/database.js';
import {
  defineDeliveryType,
  deliveriesOf,
  inboxItemsOf,
  relayedUser,
  runWorker,
  sendNotification,
  startDeliveryApp,
  type DeliveryApp,
} from '../testing/delivery.js';
import { sendingSender } from '../testing/sending.js';

// Needs a real Postgres whose user may create databases, e.g. the compose one:
// NOTIFICATION_TEST_DATABASE_URL=postgres://portal:portal@localhost:5432/portal pnpm --filter notification-api test
// PGlite has one connection, so an arrival committing while "mark all as read" runs is proven here (KTD9).
const serverUrl = process.env['NOTIFICATION_TEST_DATABASE_URL'];

const ESCALATING = 'pg-read-all-escalating';

describe.skipIf(!serverUrl)('mark all as read on Postgres (KTD9)', () => {
  const name = `notification_read_all_test_${process.pid}_${Date.now()}`;
  const target = new URL(serverUrl ?? 'postgres://unset');
  target.pathname = `/${name}`;

  let app: DeliveryApp;
  let pool: Pool;
  let credential: { authorization: string };

  beforeAll(async () => {
    await createPostgresTestDatabase(target);
    pool = new Pool({ connectionString: target.href, max: 4 });
    const db = drizzle({ client: pool, schema, casing: 'snake_case' });
    app = await startDeliveryApp({
      // The app's inbox signal listener connects to DATABASE_URL.
      env: { DATABASE_URL: target.href },
      database: () => Promise.resolve({ db, close: () => pool.end() }),
    });
    await defineDeliveryType(app.t, app.adminToken, {
      key: ESCALATING,
      policy: { mode: 'escalation', steps: [{ channel: 'email', delayMinutes: 60 }] },
    });
    const sender = await sendingSender(app.t, app.issuer, app.adminToken, 'pg-read-all-sender', [ESCALATING]);
    credential = await sender.credential('pg-read-all-sender-client', [ESCALATING]);
  });

  afterAll(async () => {
    await app?.close();
    const admin = new Client({ connectionString: serverUrl });
    await admin.connect();
    try {
      await admin.query(`drop database if exists "${name}" with (force)`);
    } finally {
      await admin.end();
    }
  });

  /** Resolves once some session in the test database is waiting on a lock. */
  async function someoneWaitsOnALock(): Promise<void> {
    for (let poll = 0; poll < 100; poll += 1) {
      // oxlint-disable-next-line no-await-in-loop -- polling until the planner blocks.
      const { rows } = await pool.query<{ waiting: number }>(
        `select count(*)::int as waiting from pg_stat_activity where datname = $1 and wait_event_type = 'Lock'`,
        [name],
      );
      if ((rows[0]?.waiting ?? 0) > 0) return;
      // oxlint-disable-next-line no-await-in-loop -- polling until the planner blocks.
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('The planner never blocked');
  }

  it('covers AE5: an item whose planning commits after the update ran stays unread with its reminder scheduled', async () => {
    const user = await relayedUser(app);
    const earlier = await sendNotification(app.t, credential, ESCALATING, user.audience);
    await runWorker(app.t);
    const inFlight = await sendNotification(app.t, credential, ESCALATING, user.audience);
    await app.t.app.get(ExpanderService).expandBatch();

    // Holding the in-flight notification's row keeps the planner's transaction open at its inbox item insert (the
    // foreign key check waits on it), so that transaction commits only after "mark all as read" has run.
    const holder = new Client({ connectionString: target.href });
    await holder.connect();
    try {
      await holder.query('begin');
      await holder.query('select id from notification.notifications where id = $1 for update', [inFlight]);
      const planning = app.t.app.get(PlannerService).planBatch();
      await someoneWaitsOnALock();

      const res = await app.t.http().post('/api/v1/me/inbox/read-all').set(user.auth);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ marked: 1 });
      await holder.query('commit');
      expect(await planning).toBe(1);
    } finally {
      await holder.end();
    }
    expect(await inboxItemsOf(app.t, earlier)).toMatchObject([{ readAt: app.clock.now() }]);
    expect(await deliveriesOf(app.t, earlier)).toMatchObject([{ step: 1, status: 'cancelled', reason: 'read in app' }]);
    expect(await inboxItemsOf(app.t, inFlight)).toMatchObject([{ readAt: null }]);
    expect(await deliveriesOf(app.t, inFlight)).toMatchObject([{ step: 1, status: 'scheduled' }]);
  });
});
