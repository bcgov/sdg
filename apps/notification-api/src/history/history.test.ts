import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  defineDeliveryType,
  registerSystem,
  relayedUser,
  runWorker,
  sendNotification,
  startDeliveryApp,
  type DeliveryApp,
} from '../testing/delivery.js';
import { bearer } from '../testing/senders.js';
import { addressAudience, sendingSender } from '../testing/sending.js';
import {
  notificationDetailSchema,
  notificationPageSchema,
  type NotificationDetail,
  type NotificationPage,
} from './history.schemas.js';

const FORM_RECEIVED = 'form-received';
const BROADCAST = 'system-broadcast';
const TYPES = [FORM_RECEIVED, BROADCAST];

let app: DeliveryApp;
let intake: { authorization: string };
let other: { authorization: string };
/** The intake sender's two F2 sends, to `Jane@Example.com` (with a form reference) and then `jane@example.com`. */
let first: string;
let second: string;

type Auth = { authorization: string };

/** GETs a history path and expects 200. */
async function get(auth: Auth, path: string): Promise<unknown> {
  const res = await app.t.http().get(path).set(auth);
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

const page = async (auth: Auth, path: string): Promise<NotificationPage> =>
  notificationPageSchema.parse(await get(auth, path));
const detail = async (auth: Auth, path: string): Promise<NotificationDetail> =>
  notificationDetailSchema.parse(await get(auth, path));
const ids = ({ items }: NotificationPage) => items.map(({ id }) => id);

beforeAll(async () => {
  app = await startDeliveryApp();
  await defineDeliveryType(app.t, app.adminToken, {
    key: FORM_RECEIVED,
    policy: { mode: 'all-at-once', channels: ['email'] },
  });
  await defineDeliveryType(app.t, app.adminToken, {
    key: BROADCAST,
    policy: { mode: 'all-at-once', channels: ['webhook'] },
  });
  const intakeSender = await sendingSender(app.t, app.issuer, app.adminToken, 'intake', TYPES);
  intake = await intakeSender.credential('intake-client', TYPES);
  const otherSender = await sendingSender(app.t, app.issuer, app.adminToken, 'other-program', TYPES);
  other = await otherSender.credential('other-program-client', TYPES);
  first = await sendNotification(app.t, intake, FORM_RECEIVED, addressAudience('Jane@Example.com', 'FORM-1042'));
  second = await sendNotification(app.t, intake, FORM_RECEIVED, addressAudience('jane@example.com'));
  await runWorker(app.t);
});

afterAll(() => app.close());

describe('public form follow-up (F2, AE6)', () => {
  it('covers F2: finds both sends by the address, in any case, and by the form reference, newest first', async () => {
    expect(ids(await page(intake, '/api/v1/notifications?address=%20JANE@example.COM'))).toEqual([second, first]);
    expect(ids(await page(intake, '/api/v1/notifications?reference=FORM-1042'))).toEqual([second, first]);
    expect(ids(await page(intake, '/api/v1/notifications?reference=FORM-9999'))).toEqual([]);
  });

  it('covers AE6: both sends went to one address-only recipient, with the content as rendered', async () => {
    const [a, b] = await Promise.all([first, second].map((id) => detail(intake, `/api/v1/notifications/${id}`)));
    expect(a?.deliveries).toHaveLength(1);
    expect(a?.deliveries[0]).toMatchObject({
      channel: 'email',
      address: 'jane@example.com',
      status: 'delivered',
      reason: null,
      attempts: [
        {
          attempt: 1,
          status: 'accepted',
          error: null,
          integrationId: 'platform:email',
          rendered: { channel: 'email', subject: 'Alert R-1' },
        },
      ],
    });
    expect(b?.deliveries).toMatchObject([{ recipientId: a?.deliveries[0]?.recipientId, address: 'jane@example.com' }]);
    expect(a).toMatchObject({ id: first, type: FORM_RECEIVED, status: 'expanded', rollUp: { total: 1, delivered: 1 } });
  });

  it('covers AE6: another sender querying the same address sees neither send, nor either by id', async () => {
    expect(ids(await page(other, '/api/v1/notifications?address=jane@example.com'))).toEqual([]);
    expect(ids(await page(other, '/api/v1/notifications?reference=FORM-1042'))).toEqual([]);
    const byId = await app.t.http().get(`/api/v1/notifications/${first}`).set(other);
    expect(byId.status).toBe(404);
  });
});

describe('admin history (R12)', () => {
  it('lets an admin read every sender’s history (R12)', async () => {
    const admin = bearer(app.adminToken);
    const all = await page(admin, '/api/v1/admin/notifications?address=jane@example.com');
    expect(ids(all)).toEqual([second, first]);
    expect(await detail(admin, `/api/v1/admin/notifications/${first}`)).toMatchObject({ id: first });
    const asSender = await app.t.http().get(`/api/v1/admin/notifications/${first}`).set(intake);
    expect(asSender.status).toBe(403);
  });
});

describe('a user recipient’s history (R43)', () => {
  it('shows the sender the user’s own address, findable by that address and by recipient id', async () => {
    const user = await relayedUser(app);
    const notificationId = await sendNotification(app.t, intake, FORM_RECEIVED, user.audience);
    await runWorker(app.t);

    const found = await detail(intake, `/api/v1/notifications/${notificationId}`);
    expect(found.deliveries).toMatchObject([
      { recipientId: user.recipientId, address: user.email, status: 'delivered' },
    ]);
    expect(found.inboxItems).toMatchObject([{ recipientId: user.recipientId, title: 'Alert R-1', readAt: null }]);
    expect(ids(await page(intake, `/api/v1/notifications?address=${user.email}`))).toEqual([notificationId]);
    expect(ids(await page(intake, `/api/v1/notifications?recipientId=${user.recipientId}`))).toEqual([notificationId]);
  });
});

describe('a broadcast’s roll-up (R55)', () => {
  it('counts the deliveries by status, with each failure’s short error', async () => {
    const sender = await sendingSender(app.t, app.issuer, app.adminToken, 'broadcaster', [BROADCAST]);
    const credential = await sender.credential('broadcaster-client', [BROADCAST]);
    app.receiver.respond('/rollup/rejects', { status: 400 });
    app.receiver.respond('/rollup/unavailable', { status: 503 });
    await registerSystem(app.t, credential, 'accepts', [app.receiver.url('/rollup/accepts')]);
    await registerSystem(app.t, credential, 'rejects', [app.receiver.url('/rollup/rejects')]);
    await registerSystem(app.t, credential, 'unavailable', [app.receiver.url('/rollup/unavailable')]);
    const notificationId = await sendNotification(app.t, credential, BROADCAST, { kind: 'everyone' });
    await runWorker(app.t);

    const found = await detail(credential, `/api/v1/notifications/${notificationId}`);
    expect(found.rollUp).toEqual({
      total: 3,
      scheduled: 1,
      sending: 0,
      delivered: 1,
      failed: 1,
      cancelled: 0,
      skipped: 0,
    });
    const byAddress = Object.fromEntries(found.deliveries.map((delivery) => [delivery.address, delivery]));
    expect(byAddress[app.receiver.url('/rollup/rejects')]).toMatchObject({
      status: 'failed',
      reason: 'permanent failure',
      attempts: [{ status: 'failed', error: 'HTTP 400', rendered: { channel: 'webhook' } }],
    });
    expect(byAddress[app.receiver.url('/rollup/unavailable')]).toMatchObject({
      status: 'scheduled',
      attempts: [{ status: 'failed', error: 'HTTP 503' }],
    });
    const list = await page(credential, '/api/v1/notifications');
    expect(list.items).toMatchObject([{ id: notificationId, rollUp: { total: 3, delivered: 1, failed: 1 } }]);
  });
});

describe('pagination', () => {
  it('pages through a sender’s history with a cursor, newest first', async () => {
    const address = 'paged@example.com';
    const sent: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- the sends' order is what the pages are ordered by.
      sent.push(await sendNotification(app.t, intake, FORM_RECEIVED, addressAudience(address)));
    }
    const page1 = await page(intake, `/api/v1/notifications?address=${address}&limit=2`);
    expect(ids(page1)).toEqual([sent[2], sent[1]]);
    expect(page1.nextCursor).toEqual(expect.any(String));

    const page2 = await page(intake, `/api/v1/notifications?address=${address}&limit=2&cursor=${page1.nextCursor}`);
    expect(ids(page2)).toEqual([sent[0]]);
    expect(page2.nextCursor).toBeNull();
  });
});
