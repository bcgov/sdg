import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { idempotencyKeys } from '../database/schema/index.js';
import { createTestApp, type TestApp } from '../testing/app.js';
import { notificationsOf, SEND_PATH, sendingSender, type SendingSender } from '../testing/sending.js';
import { startTestIssuer, type TestIssuer } from '../testing/tokens.js';

// typeDefinition's types: a required `reference`, email all at once.
const TYPE = 'licence-renewed';

let t: TestApp;
let issuer: TestIssuer;
let permits: SendingSender;
let permitsCredential: { authorization: string };
let parks: SendingSender;
let parksCredential: { authorization: string };

beforeAll(async () => {
  issuer = await startTestIssuer();
  t = await createTestApp({ env: issuer.env, issuerFetch: issuer.fetch });
  const adminToken = await issuer.ownClientUserToken({ admin: true });
  [permits, parks] = await Promise.all([
    sendingSender(t, issuer, adminToken, 'permits', [TYPE]),
    sendingSender(t, issuer, adminToken, 'parks', [TYPE]),
  ]);
  await Promise.all([permits.overrideEmail(), parks.overrideEmail()]);
  [permitsCredential, parksCredential] = await Promise.all([
    permits.credential('permits-client', [TYPE]),
    parks.credential('parks-client', [TYPE]),
  ]);
});

afterAll(async () => {
  await t.close();
  await issuer.close();
});

const body = (idempotencyKey: string, reference = 'R-1') => ({
  type: TYPE,
  idempotencyKey,
  data: { reference },
  audience: { kind: 'recipients', recipients: [{ kind: 'address', channel: 'email', address: 'a@example.com' }] },
});

const send = (credential: { authorization: string }, payload: object) =>
  t.http().post(SEND_PATH).set(credential).send(payload);

describe('idempotency keys (KTD13)', () => {
  it('a replay of the same key and body returns the original notification id and status, storing nothing new', async () => {
    const key = randomUUID();
    const first = await send(permitsCredential, body(key));
    const before = await notificationsOf(t, permits.id);
    // The same content with its keys in another order is the same canonical body.
    const { audience, data, idempotencyKey, type } = body(key);
    const replay = await send(permitsCredential, { audience, data, idempotencyKey, type });

    expect(first.status).toBe(202);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ notificationId: first.body.notificationId, status: 'accepted' });
    expect(await notificationsOf(t, permits.id)).toHaveLength(before.length);
  });

  it('the same key with a different body is rejected with 409 and stores nothing', async () => {
    const key = randomUUID();
    const first = await send(permitsCredential, body(key, 'R-1'));
    const before = await notificationsOf(t, permits.id);

    const changed = await send(permitsCredential, body(key, 'R-2'));

    expect(first.status).toBe(202);
    expect(changed.status).toBe(409);
    expect(changed.body.message).toBe('This idempotency key was already used with a different request');
    expect(await notificationsOf(t, permits.id)).toHaveLength(before.length);
  });

  it('keys are scoped to the sender: another sender using the same key gets its own notification', async () => {
    const key = randomUUID();
    const mine = await send(permitsCredential, body(key));
    const theirs = await send(parksCredential, body(key, 'R-9'));

    expect([mine.status, theirs.status]).toEqual([202, 202]);
    expect(theirs.body.notificationId).not.toBe(mine.body.notificationId);
  });

  it('a key older than 24 hours counts as unused', async () => {
    const key = randomUUID();
    const first = await send(permitsCredential, body(key, 'R-1'));
    await t.database.db
      .update(idempotencyKeys)
      .set({ createdAt: sql`now() - interval '25 hours'` })
      .where(and(eq(idempotencyKeys.senderId, permits.id), eq(idempotencyKeys.key, key)));

    const again = await send(permitsCredential, body(key, 'R-2'));

    expect(again.status).toBe(202);
    expect(again.body.notificationId).not.toBe(first.body.notificationId);
    const [stored] = await t.database.db
      .select({ notificationId: idempotencyKeys.notificationId })
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.senderId, permits.id), eq(idempotencyKeys.key, key)));
    expect(stored?.notificationId).toBe(again.body.notificationId);
  });
});
