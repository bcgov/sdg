import { randomUUID } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';

import type { DeliveryPolicy } from '../catalog/policy.js';
import { CHANNELS, type Channel } from '../channels/channels.js';
import { deliveries, deliveryAttempts, inboxItems, notificationRecipients } from '../database/schema/index.js';
import { CLOCK, type Clock } from '../delivery/settings.js';
import { DeliveryLoop } from '../delivery/worker-loop.js';
import { createTestApp, type TestApp } from './app.js';
import { platformSmtpEnv } from './recipients.js';
import { bearer } from './senders.js';
import { SEND_PATH } from './sending.js';
import { startTestSmtpServer, type TestSmtpServer } from './smtp-server.js';
import { ensureSaved, mjml, templatesApi } from './templates.js';
import { startTestIssuer, type TestIssuer } from './tokens.js';
import { startWebhookReceiver, type TestWebhookReceiver } from './webhook-receiver.js';

/** A clock tests set and move. Starts on Tuesday 5 January 2027 at 18:00 UTC (10:00 in Los Angeles). */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start = new Date('2027-01-05T18:00:00Z')) {
    this.current = start;
  }

  now(): Date {
    return new Date(this.current);
  }

  set(at: Date | string): void {
    this.current = new Date(at);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** The data every delivery-test type takes. */
export const DATA = { reference: 'R-1' };

/** Template parts per channel, all rendering the reference. */
const PARTS: Record<Channel, Record<string, string>> = {
  email: { subject: 'Alert {{ reference }}', html: mjml('Alert {{ reference }}') },
  'in-app': { title: 'Alert {{ reference }}', body: 'Alert **{{ reference }}**' },
  webhook: { payload: '{"reference": "{{ reference }}"}' },
};

export interface DeliveryTypeSetup {
  key: string;
  policy: DeliveryPolicy;
  /** The channels with a template, by language; defaults to every channel in en-CA. */
  templates?: Partial<Record<Channel, readonly string[]>>;
}

/** Defines a type with a `reference` data contract and saves its templates through the admin API. */
export async function defineDeliveryType(t: TestApp, adminToken: string, setup: DeliveryTypeSetup): Promise<void> {
  const templates = templatesApi(t, adminToken);
  await templates.defineType({
    key: setup.key,
    displayName: setup.key,
    dataContract: { type: 'object', properties: { reference: { type: 'string' } }, required: ['reference'] },
    defaultLanguage: 'en-CA',
    policy: setup.policy,
  });
  const byChannel = setup.templates ?? { email: ['en-CA'], 'in-app': ['en-CA'], webhook: ['en-CA'] };
  for (const channel of CHANNELS) {
    for (const language of byChannel[channel] ?? []) {
      const parts = { ...PARTS[channel] };
      if (channel === 'email' && language.startsWith('fr')) parts['subject'] = 'Alerte {{ reference }}';
      // oxlint-disable-next-line no-await-in-loop -- versions are saved one at a time through the API.
      ensureSaved(await templates.save(setup.key, channel, language, parts));
    }
  }
}

/** Sends `type` with DATA through the credential and returns the notification id. */
export async function sendNotification(
  t: TestApp,
  credential: { authorization: string },
  type: string,
  audience: Record<string, unknown>,
): Promise<string> {
  const res = await t
    .http()
    .post(SEND_PATH)
    .set(credential)
    .send({ type, data: DATA, idempotencyKey: randomUUID(), audience });
  if (res.status !== 202) throw new Error(`Expected 202, got ${res.status}: ${JSON.stringify(res.body)}`);
  const id: unknown = res.body.notificationId;
  if (typeof id !== 'string') throw new Error('The send returned no notification id');
  return id;
}

/** Runs the worker loop's ticks until one does nothing. */
export async function runWorker(t: TestApp): Promise<void> {
  const loop = t.app.get(DeliveryLoop);
  for (let tick = 0; tick < 50; tick += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each tick works on what the previous one left.
    const done = await loop.tick();
    if (done.expanded + done.planned + done.deliveries + done.callbacks === 0) return;
  }
  throw new Error('The worker was still busy after 50 ticks');
}

/** The notification's deliveries, by step then address. */
export const deliveriesOf = (t: TestApp, notificationId: string) =>
  t.database.db
    .select()
    .from(deliveries)
    .where(eq(deliveries.notificationId, notificationId))
    .orderBy(asc(deliveries.step), asc(deliveries.address));

export const attemptsOf = (t: TestApp, deliveryId: string) =>
  t.database.db
    .select()
    .from(deliveryAttempts)
    .where(eq(deliveryAttempts.deliveryId, deliveryId))
    .orderBy(asc(deliveryAttempts.attempt));

export const inboxItemsOf = (t: TestApp, notificationId: string) =>
  t.database.db.select().from(inboxItems).where(eq(inboxItems.notificationId, notificationId));

/** Registers one of the sender's systems with webhook endpoints and returns its secrets by URL. */
export async function registerSystem(
  t: TestApp,
  credential: { authorization: string },
  systemId: string,
  webhookUrls: readonly string[],
): Promise<Map<string, string>> {
  const res = await t.http().post('/api/v1/recipients/systems').set(credential).send({ systemId, webhookUrls });
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  const webhooks: { url: string; secret: string | null }[] = res.body.webhooks;
  return new Map(webhooks.flatMap(({ url, secret }) => (secret === null ? [] : [[url, secret]])));
}

/** Sets the sender's failure callback URL as its owner and returns the callback's signing secret. */
export async function setCallback(t: TestApp, senderId: string, ownerToken: string, url: string): Promise<string> {
  const res = await t.http().put(`/api/v1/senders/${senderId}/callback`).set(bearer(ownerToken)).send({ url });
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  return String(res.body.secret);
}

export const systemAudience = (systemId: string) => ({
  kind: 'recipients',
  recipients: [{ kind: 'system', systemId }],
});

/** A test app whose delivery clock is a FakeClock, with an SMTP server and a webhook receiver on 127.0.0.1. */
export interface DeliveryApp {
  t: TestApp;
  issuer: TestIssuer;
  clock: FakeClock;
  smtp: TestSmtpServer;
  receiver: TestWebhookReceiver;
  adminToken: string;
  close(): Promise<void>;
}

export interface DeliveryAppOptions {
  /** Whether email has the platform default integration (the in-process SMTP server). Default true. */
  platformEmail?: boolean;
  /** Env overrides, e.g. a short NOTIFICATION_WORKER_POLL_MS so the loop runs on its own. */
  env?: Record<string, string>;
}

export async function startDeliveryApp({
  platformEmail = true,
  env = {},
}: DeliveryAppOptions = {}): Promise<DeliveryApp> {
  const [issuer, smtp, receiver] = await Promise.all([
    startTestIssuer(),
    startTestSmtpServer(),
    startWebhookReceiver(),
  ]);
  const clock = new FakeClock();
  const email = platformEmail ? platformSmtpEnv(smtp) : { NOTIFICATION_OUTBOUND_ALLOW_HOSTS: '127.0.0.1' };
  const t = await createTestApp({
    env: { ...issuer.env, ...email, ...env },
    issuerFetch: issuer.fetch,
    overrides: [{ provide: CLOCK, useValue: clock }],
  });
  const adminToken = await issuer.ownClientUserToken({ admin: true });
  return {
    t,
    issuer,
    clock,
    smtp,
    receiver,
    adminToken,
    close: async () => {
      await t.close();
      await Promise.all([issuer.close(), smtp.close(), receiver.close()]);
    },
  };
}

/** A user who reached notification-api through the portal, so their verified IdP email is their own point (R32). */
export interface RelayedUser {
  subject: string;
  recipientId: string;
  /** Their IdP email, as the test issuer sets it. */
  email: string;
  /** A bearer header with their relayed token, for /me endpoints. */
  auth: { authorization: string };
  /** The send audience naming them by issuer + subject. */
  audience: Record<string, unknown>;
}

export async function relayedUser(app: DeliveryApp, subject: string = `user-${randomUUID()}`): Promise<RelayedUser> {
  const auth = bearer(await app.issuer.relayingUserToken({ subject }));
  const res = await app.t.http().get('/api/v1/me').set(auth);
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  return {
    subject,
    recipientId: String(res.body.id),
    email: `${subject}@example.gov.bc.ca`,
    auth,
    audience: { kind: 'recipients', recipients: [{ kind: 'user', issuer: app.issuer.issuer, subject }] },
  };
}

/** The notification recipient row for one recipient of a notification. */
export async function notificationRecipientId(
  t: TestApp,
  notificationId: string,
  recipientId: string,
): Promise<string> {
  const [row] = await t.database.db
    .select({ id: notificationRecipients.id })
    .from(notificationRecipients)
    .where(
      and(
        eq(notificationRecipients.notificationId, notificationId),
        eq(notificationRecipients.recipientId, recipientId),
      ),
    );
  if (!row) throw new Error('The recipient is not in the notification');
  return row.id;
}
