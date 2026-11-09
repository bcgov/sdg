import { randomUUID } from 'node:crypto';

import type { DeliveryPolicy } from '@repo/notification-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  defineDeliveryType,
  inboxItemsOf,
  relayedUser,
  runWorker,
  sendNotification,
  startDeliveryApp,
  type DeliveryApp,
  type RelayedUser,
} from '../testing/delivery.js';
import { sendingSender } from '../testing/sending.js';
import { ensureSaved, templatesApi } from '../testing/templates.js';

const ALERT = 'inbox-queries-alert';
const LONG = 'inbox-queries-long';
const NO_IN_APP = 'inbox-queries-no-in-app';
const INBOX = '/api/v1/me/inbox';
const POLICY: DeliveryPolicy = { mode: 'escalation', steps: [{ channel: 'email', delayMinutes: 60 }] };

/** The long in-app body, and the plain text it renders to before any cut. */
const REPEATED = 'before the work starts on site. ';
const LONG_BODY = `## Permit {{ reference }} is ready\n\nPlease **review** the [conditions](https://example.gov.bc.ca/conditions) ${REPEATED.repeat(10)}`;
const LONG_TEXT = `Permit R-1 is ready Please review the conditions ${REPEATED.repeat(10)}`.trim();

let app: DeliveryApp;
let credential: { authorization: string };

beforeAll(async () => {
  app = await startDeliveryApp();
  await defineDeliveryType(app.t, app.adminToken, { key: ALERT, policy: POLICY });
  await defineDeliveryType(app.t, app.adminToken, { key: LONG, policy: POLICY, templates: { email: ['en-CA'] } });
  await defineDeliveryType(app.t, app.adminToken, { key: NO_IN_APP, policy: POLICY, templates: { email: ['en-CA'] } });
  ensureSaved(
    await templatesApi(app.t, app.adminToken).save(LONG, 'in-app', 'en-CA', { title: 'Permit', body: LONG_BODY }),
  );
  const sender = await sendingSender(app.t, app.issuer, app.adminToken, 'inbox-queries-sender', [
    ALERT,
    LONG,
    NO_IN_APP,
  ]);
  credential = await sender.credential('inbox-queries-client', [ALERT, LONG, NO_IN_APP]);
});

afterAll(() => app.close());

/** Sends `type` to the user, plans it a minute after the last, and returns the notification and inbox item ids. */
async function sendTo(user: RelayedUser, type = ALERT): Promise<{ notificationId: string; itemId: string }> {
  app.clock.advanceMinutes(1);
  const notificationId = await sendNotification(app.t, credential, type, user.audience);
  await runWorker(app.t);
  const [item] = await inboxItemsOf(app.t, notificationId);
  if (!item) throw new Error('No inbox item was created');
  return { notificationId, itemId: item.id };
}

/** Sends ALERT to the user `count` times, one after another, and returns the item ids oldest first. */
async function sendMany(user: RelayedUser, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each item is created a minute after the last.
    ids.push((await sendTo(user)).itemId);
  }
  return ids;
}

const read = (user: RelayedUser, itemId: string) => app.t.http().post(`${INBOX}/${itemId}/read`).set(user.auth);
const unreadCount = async (user: RelayedUser): Promise<unknown> =>
  (await app.t.http().get(`${INBOX}/unread-count`).set(user.auth).expect(200)).body;

describe('the unread filter (R10)', () => {
  it('lists only unread items, newest first, and its cursor pages through further unread items', async () => {
    const user = await relayedUser(app);
    const [first, second, third, fourth] = await sendMany(user, 4);
    await read(user, String(third)).expect(200);

    const page1 = await app.t.http().get(`${INBOX}?unread=true&limit=2`).set(user.auth);
    expect(page1.status).toBe(200);
    expect(page1.body.items.map((item: { id: string }) => item.id)).toEqual([fourth, second]);
    expect(page1.body.items).toMatchObject([{ readAt: null }, { readAt: null }]);

    const page2 = await app.t
      .http()
      .get(`${INBOX}?unread=true&limit=2&cursor=${String(page1.body.nextCursor)}`)
      .set(user.auth);
    expect(page2.body).toMatchObject({ items: [{ id: first }], nextCursor: null });

    const all = await app.t.http().get(INBOX).set(user.auth);
    expect(all.body.items.map((item: { id: string }) => item.id)).toEqual([fourth, third, second, first]);
  });
});

describe('the unread count (R2, R10)', () => {
  it('is 0 for a new recipient, rises with deliveries and falls after a read', async () => {
    const user = await relayedUser(app);
    expect(await unreadCount(user)).toEqual({ unread: 0 });

    const [first] = await sendMany(user, 2);
    expect(await unreadCount(user)).toEqual({ unread: 2 });

    await read(user, String(first)).expect(200);
    expect(await unreadCount(user)).toEqual({ unread: 1 });
  });
});

describe('the excerpt (R5)', () => {
  it('is the body as plain text with no tags, cut on a word boundary under 140 characters', async () => {
    const user = await relayedUser(app);
    await sendTo(user, LONG);

    const listed = await app.t.http().get(INBOX).set(user.auth);
    const [item] = listed.body.items;
    expect(item.body).toContain('<strong>review</strong>');
    const excerpt: string = item.excerpt;
    expect(excerpt.length).toBeLessThanOrEqual(140);
    expect(excerpt).toMatch(/^Permit R-1 is ready Please review the conditions before the work/);
    expect(excerpt).not.toMatch(/[<>*#]|https:/);
    expect(excerpt.endsWith('…')).toBe(true);
    const kept = excerpt.slice(0, -1);
    expect(LONG_TEXT.startsWith(kept)).toBe(true);
    expect(LONG_TEXT[kept.length]).toBe(' ');
  });

  it('is null when the body is null', async () => {
    const user = await relayedUser(app);
    await sendTo(user, NO_IN_APP);

    const listed = await app.t.http().get(INBOX).set(user.auth);
    expect(listed.body.items).toMatchObject([{ body: null, excerpt: null }]);
  });
});

describe('one item by notification id (R17, R18)', () => {
  it('returns the caller’s own item with its id and read time, without marking it read', async () => {
    const user = await relayedUser(app);
    const { notificationId, itemId } = await sendTo(user);

    const found = await app.t.http().get(`${INBOX}/by-notification/${notificationId}`).set(user.auth);
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({ id: itemId, notificationId, readAt: null, title: 'Alert R-1' });
    expect(found.body.excerpt).toBe('Alert R-1');
    expect(await unreadCount(user)).toEqual({ unread: 1 });

    await read(user, itemId).expect(200);
    const again = await app.t.http().get(`${INBOX}/by-notification/${notificationId}`).set(user.auth);
    expect(again.body).toMatchObject({ id: itemId, readAt: app.clock.now().toISOString() });
  });

  it('answers 404 with one body for another recipient’s notification, an unknown id and a non-uuid id (AE4)', async () => {
    const owner = await relayedUser(app);
    const stranger = await relayedUser(app);
    const { notificationId } = await sendTo(owner);

    const [theirs, unknown, malformed] = await Promise.all(
      [notificationId, randomUUID(), 'not-a-uuid'].map((id) =>
        app.t.http().get(`${INBOX}/by-notification/${id}`).set(stranger.auth),
      ),
    );
    expect([theirs?.status, unknown?.status, malformed?.status]).toEqual([404, 404, 404]);
    expect(theirs?.body).toEqual(unknown?.body);
    expect(malformed?.body).toEqual(unknown?.body);
    expect(await inboxItemsOf(app.t, notificationId)).toMatchObject([{ readAt: null }]);
  });
});

describe('the OpenAPI document', () => {
  it('lists the new recipient endpoints under me', async () => {
    const doc = await app.t.http().get('/api/docs-json').expect(200);
    const paths: Record<string, Record<string, { tags?: string[] }>> = doc.body.paths;
    expect(paths[`${INBOX}/unread-count`]?.['get']?.tags).toEqual(['me']);
    expect(paths[`${INBOX}/by-notification/{notificationId}`]?.['get']?.tags).toEqual(['me']);
    const listParameters = JSON.stringify(paths[INBOX]?.['get']);
    expect(listParameters).toContain('"unread"');
  });
});
