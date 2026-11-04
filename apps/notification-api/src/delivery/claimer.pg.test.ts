import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../database/run-migrations.js';
import * as schema from '../database/schema/index.js';
import { deliveries } from '../database/schema/index.js';
import { GuardedHttpClient } from '../outbound/http-dispatcher.js';
import { OutboundGuard } from '../outbound/outbound-guard.js';
import { createTestApp, type TestApp } from '../testing/app.js';
import {
  attemptsOf,
  defineDeliveryType,
  deliveriesOf,
  FakeClock,
  registerSystem,
  runWorker,
  sendNotification,
} from '../testing/delivery.js';
import { sendingSender } from '../testing/sending.js';
import { startTestIssuer, type TestIssuer } from '../testing/tokens.js';
import { startWebhookReceiver, type TestWebhookReceiver } from '../testing/webhook-receiver.js';
import { DeliveryClaimer } from './claimer.js';
import { ExpanderService } from './expander.js';
import { PlannerService } from './planner.js';
import { DeliveryWorker } from './processor.js';
import { CLOCK, DELIVERY_SETTINGS, type DeliverySettings } from './settings.js';

// Needs a real Postgres whose user may create databases, e.g. the compose one:
// NOTIFICATION_TEST_DATABASE_URL=postgres://portal:portal@localhost:5432/portal pnpm --filter notification-api test
// PGlite has one connection, so claim concurrency and lease reclaim are proven here (KTD1).
const serverUrl = process.env['NOTIFICATION_TEST_DATABASE_URL'];

const HOOK_TYPE = 'pg-hook';
/** Short, so a slow receiver outlasts it; the lease is this plus the margin. */
const TIMEOUT_MS = 400;

describe.skipIf(!serverUrl)('the delivery queue on Postgres (KTD1)', () => {
  const name = `notification_claimer_test_${process.pid}_${Date.now()}`;
  const target = new URL(serverUrl ?? 'postgres://unset');
  target.pathname = `/${name}`;

  let t: TestApp;
  let issuer: TestIssuer;
  let receiver: TestWebhookReceiver;
  let credential: { authorization: string };
  const clock = new FakeClock();
  let settings: DeliverySettings;

  beforeAll(async () => {
    await runMigrations(target.href);
    [issuer, receiver] = await Promise.all([startTestIssuer(), startWebhookReceiver()]);
    // Two connections, so two claims really run at once.
    const pool = new Pool({ connectionString: target.href, max: 2 });
    const db = drizzle({ client: pool, schema, casing: 'snake_case' });
    const http = new GuardedHttpClient(new OutboundGuard({ allowHosts: ['127.0.0.1'] }), { timeoutMs: TIMEOUT_MS });
    t = await createTestApp({
      env: { ...issuer.env, NOTIFICATION_OUTBOUND_ALLOW_HOSTS: '127.0.0.1' },
      issuerFetch: issuer.fetch,
      database: () => Promise.resolve({ db, close: () => pool.end() }),
      overrides: [
        { provide: CLOCK, useValue: clock },
        { provide: GuardedHttpClient, useValue: http },
      ],
    });
    settings = t.app.get<DeliverySettings>(DELIVERY_SETTINGS);
    const adminToken = await issuer.ownClientUserToken({ admin: true });
    await defineDeliveryType(t, adminToken, {
      key: HOOK_TYPE,
      policy: { mode: 'all-at-once', channels: ['webhook'] },
      templates: { webhook: ['en-CA'] },
    });
    const sender = await sendingSender(t, issuer, adminToken, 'pg-sender', [HOOK_TYPE]);
    credential = await sender.credential('pg-sender-client', [HOOK_TYPE]);
  });

  afterEach(async () => {
    // Each test works only on the rows it created.
    await t.database.db
      .update(deliveries)
      .set({ status: 'cancelled' })
      .where(inArray(deliveries.status, ['scheduled', 'sending']));
  });

  afterAll(async () => {
    await t?.close();
    await Promise.all([issuer?.close(), receiver?.close()]);
    const admin = new Client({ connectionString: serverUrl });
    await admin.connect();
    try {
      await admin.query(`drop database if exists "${name}" with (force)`);
    } finally {
      await admin.end();
    }
  });

  /** Sends to new systems with the `hooks` endpoints (ten per system) and plans it, leaving its deliveries due. */
  async function plannedHooks(prefix: string, hooks: readonly string[]): Promise<string> {
    const systems = Array.from({ length: Math.ceil(hooks.length / 10) }, (_, index) => `${prefix}-${index}`);
    for (const [index, systemId] of systems.entries()) {
      const urls = hooks.slice(index * 10, index * 10 + 10).map((path) => receiver.url(path));
      // oxlint-disable-next-line no-await-in-loop -- a few registrations in setup.
      await registerSystem(t, credential, systemId, urls);
    }
    const audience = { kind: 'recipients', recipients: systems.map((systemId) => ({ kind: 'system', systemId })) };
    const notificationId = await sendNotification(t, credential, HOOK_TYPE, audience);
    await t.app.get(ExpanderService).expandBatch();
    // oxlint-disable-next-line no-await-in-loop -- planning works in batches.
    while ((await t.app.get(PlannerService).planBatch()) > 0);
    return notificationId;
  }

  it('never gives two workers claiming at once the same delivery', async () => {
    const hooks = Array.from({ length: 24 }, (_, index) => `/concurrent/${index}`);
    const notificationId = await plannedHooks('concurrent', hooks);
    const claimer = t.app.get(DeliveryClaimer);

    const [first, second] = await Promise.all([claimer.claim(16), claimer.claim(16)]);

    const firstIds = first.map((row) => row.id);
    const secondIds = second.map((row) => row.id);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(hooks.length);
    const rows = await deliveriesOf(t, notificationId);
    expect(rows.every((row) => row.status === 'sending' && row.attempts === 1)).toBe(true);
  });

  it('reclaims a crashed claim only once its lease expires, with the same delivery id', async () => {
    const notificationId = await plannedHooks('lease', ['/lease']);
    const claimer = t.app.get(DeliveryClaimer);
    const [claimed] = await claimer.claim();
    expect(claimed).toBeDefined();

    clock.advanceMs(settings.leaseMs - 1);
    expect(await claimer.claim()).toEqual([]);
    clock.advanceMs(1);
    const [reclaimed] = await claimer.claim();

    expect(reclaimed?.id).toBe(claimed?.id);
    expect(reclaimed?.attempts).toBe(2);
    expect(await deliveriesOf(t, notificationId)).toHaveLength(1);
  });

  it('covers AE15: a crash after the receiver got a webhook redelivers it with the same webhook-id, as one delivery', async () => {
    const notificationId = await plannedHooks('crash', ['/crash']);
    const [claimed] = await t.app.get(DeliveryClaimer).claim();
    if (!claimed) throw new Error('Nothing was claimed');
    // The worker hands the webhook to the receiver, then dies before recording the outcome.
    await t.app.get(DeliveryWorker).attempt(claimed);
    expect(receiver.requestsTo('/crash')).toHaveLength(1);

    clock.advanceMs(settings.leaseMs);
    await runWorker(t);

    const received = receiver.requestsTo('/crash');
    expect(received).toHaveLength(2);
    expect(received.map((request) => request.headers['webhook-id'])).toEqual([claimed.id, claimed.id]);
    const rows = await deliveriesOf(t, notificationId);
    expect(rows).toMatchObject([{ id: claimed.id, status: 'delivered', attempts: 2 }]);
  });

  it('fails a send slower than its timeout as retryable, without reclaiming it while it is in flight', async () => {
    receiver.respond('/slow', { status: 204, delayMs: TIMEOUT_MS * 4 });
    const notificationId = await plannedHooks('slow', ['/slow']);
    const claimedAt = clock.now();

    const tick = runWorker(t);
    // Past the outbound timeout but inside the lease: another worker finds nothing to claim.
    await new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS / 2));
    clock.advanceMs(settings.timeoutMs + 1);
    expect(await t.app.get(DeliveryClaimer).claim()).toEqual([]);
    await tick;

    const [row] = await deliveriesOf(t, notificationId);
    expect(row).toMatchObject({ status: 'scheduled', attempts: 1, leaseUntil: null });
    expect(row?.dueAt?.getTime()).toBe(claimedAt.getTime() + settings.timeoutMs + 1 + 30_000);
    const attempts = await attemptsOf(t, row?.id ?? '');
    expect(attempts).toMatchObject([{ attempt: 1, status: 'failed', integrationId: 'platform:webhook' }]);
    expect(attempts[0]?.error).toMatch(/timeout|aborted/i);
    expect(receiver.requestsTo('/slow')).toHaveLength(1);
  });
});
