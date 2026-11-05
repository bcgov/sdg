import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';
import { relayed, senderWithCredential, userRows, type CredentialSender } from '../testing/recipients.js';
import { bearer } from '../testing/senders.js';
import { startTestIssuer, type TestIssuer } from '../testing/tokens.js';
import { ContactPointsService } from './contact-points.service.js';
import { RecipientsService } from './recipients.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

let t: TestApp;
let issuer: TestIssuer;
let admin: { authorization: string };
let permits: CredentialSender;
let parks: CredentialSender;

beforeAll(async () => {
  issuer = await startTestIssuer();
  t = await createTestApp({
    env: { ...issuer.env, NOTIFICATION_OUTBOUND_ALLOW_HOSTS: 'webhook-receiver' },
    issuerFetch: issuer.fetch,
  });
  const adminToken = await issuer.ownClientUserToken({ admin: true });
  admin = bearer(adminToken);
  [permits, parks] = await Promise.all([
    senderWithCredential(t, issuer, adminToken, 'permits'),
    senderWithCredential(t, issuer, adminToken, 'parks'),
  ]);
});

afterAll(async () => {
  await t.close();
  await issuer.close();
});

describe('system recipients (R33, KTD10)', () => {
  it('registers https webhook endpoints, each with a signing secret returned once and stored sealed', async () => {
    const systemId = `system-${randomUUID()}`;
    const body = { systemId, webhookUrls: ['https://hooks.example.com/a', 'http://webhook-receiver/b'] };

    const first = await t.http().post('/api/v1/recipients/systems').set(permits.credential).send(body);
    const again = await t.http().post('/api/v1/recipients/systems').set(permits.credential).send(body);

    expect(first.status).toBe(200);
    expect(first.body.webhooks).toHaveLength(2);
    for (const webhook of first.body.webhooks) expect(webhook.secret).toMatch(/^whsec_/);
    expect(again.body.webhooks.map((webhook: { secret: unknown }) => webhook.secret)).toEqual([null, null]);
    const id = await t.app.get(RecipientsService).findSystem(permits.id, systemId);
    const usable = await t.app.get(ContactPointsService).usable(String(id), 'webhook', permits.id);
    const stored = usable.points.find((point) => point.address === 'https://hooks.example.com/a');
    const returned = first.body.webhooks.find(
      (webhook: { url: string }) => webhook.url === 'https://hooks.example.com/a',
    );
    expect(stored?.signingSecret).toBe(returned.secret);
    expect(await t.app.get(RecipientsService).findSystem(parks.id, systemId)).toBeNull();
  });

  it('rejects an http webhook URL whose host is not allow-listed', async () => {
    const res = await t
      .http()
      .post('/api/v1/recipients/systems')
      .set(permits.credential)
      .send({ systemId: 'plain', webhookUrls: ['http://hooks.example.com/a'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Must be an https:// URL');
  });
});

async function platformTopic(selfSubscribe: boolean): Promise<string> {
  const key = `topic-${randomUUID()}`;
  const res = await t.http().post('/api/v1/admin/topics').set(admin).send({ key, name: key, selfSubscribe });
  expect(res.status).toBe(201);
  return String(res.body.id);
}

describe('topic subscriptions (R17)', () => {
  it('a user self-subscribes to a platform topic that allows it and is rejected on one that does not', async () => {
    const [open, closed] = await Promise.all([platformTopic(true), platformTopic(false)]);
    const user = await relayed(issuer, randomUUID());

    const allowed = await t.http().put(`/api/v1/me/subscriptions/${open}`).set(user);
    const denied = await t.http().put(`/api/v1/me/subscriptions/${closed}`).set(user);

    expect(allowed.status).toBe(204);
    expect(denied.status).toBe(403);
    const mine = await t.http().get('/api/v1/me/subscriptions').set(user);
    expect(mine.body.map((topic: { id: string }) => topic.id)).toEqual([open]);
    const me = await t.http().get('/api/v1/me').set(user);
    expect(await t.app.get(SubscriptionsService).subscribers(open)).toEqual([me.body.id]);

    expect((await t.http().delete(`/api/v1/me/subscriptions/${open}`).set(user)).status).toBe(204);
    expect(await t.app.get(SubscriptionsService).subscribers(open)).toEqual([]);
  });

  it('a sender without a broadcast grant cannot subscribe recipients to a platform topic; with one it can', async () => {
    const topic = await platformTopic(false);
    const person = { issuer: issuer.issuer, subject: randomUUID() };
    const subscribe = () => t.http().post(`/api/v1/topics/${topic}/subscribers`).set(permits.credential).send(person);

    const refused = await subscribe();

    expect(refused.status).toBe(404);
    expect(await t.app.get(SubscriptionsService).subscribers(topic)).toEqual([]);
    expect(await userRows(t, issuer, person.subject)).toEqual([]);

    expect((await t.http().put(`/api/v1/admin/topics/${topic}/broadcasters/${permits.id}`).set(admin)).status).toBe(
      200,
    );
    expect((await subscribe()).status).toBe(204);
    const [row] = await userRows(t, issuer, person.subject);
    expect(await t.app.get(SubscriptionsService).subscribers(topic)).toEqual([row?.id]);
  });

  it('a sender subscribes only its own systems', async () => {
    const created = await t
      .http()
      .post('/api/v1/topics')
      .set(parks.credential)
      .send({ key: `permit-${randomUUID()}`, name: 'Permit' });
    const systemId = `system-${randomUUID()}`;
    await t
      .http()
      .post('/api/v1/recipients/systems')
      .set(permits.credential)
      .send({ systemId, webhookUrls: ['https://hooks.example.com/x'] });

    const res = await t
      .http()
      .post(`/api/v1/topics/${created.body.id}/subscribers`)
      .set(parks.credential)
      .send({ systemId });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('No system recipient with this id');
  });
});
