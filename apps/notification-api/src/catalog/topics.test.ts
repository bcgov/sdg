import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';
import { senderWithCredential, type CredentialSender } from '../testing/recipients.js';
import { bearer } from '../testing/senders.js';
import { startTestIssuer, type TestIssuer } from '../testing/tokens.js';
import { TopicsService } from './topics.service.js';

let t: TestApp;
let issuer: TestIssuer;
let adminToken: string;
let admin: { authorization: string };

beforeAll(async () => {
  issuer = await startTestIssuer();
  t = await createTestApp({ env: issuer.env, issuerFetch: issuer.fetch });
  adminToken = await issuer.ownClientUserToken({ admin: true });
  admin = bearer(adminToken);
});

afterAll(async () => {
  await t.close();
  await issuer.close();
});

async function platformTopic(key: string, selfSubscribe?: boolean): Promise<string> {
  const res = await t.http().post('/api/v1/admin/topics').set(admin).send({ key, name: key, selfSubscribe });
  expect(res.status).toBe(201);
  return String(res.body.id);
}

async function senderTopic(sender: CredentialSender, key: string): Promise<string> {
  const res = await t
    .http()
    .post('/api/v1/topics')
    .set(sender.credential)
    .send({ key, name: `Permit ${key}` });
  expect(res.status).toBe(201);
  return String(res.body.id);
}

const broadcasterPath = (topicId: string, senderId: string) =>
  `/api/v1/admin/topics/${topicId}/broadcasters/${senderId}`;

const canBroadcast = async (senderId: string, topicId: string): Promise<boolean> =>
  (await t.app.get(TopicsService).broadcastable(senderId, topicId)) !== null;

describe('F6 setup: platform topic, broadcast grant, sender topic', () => {
  it('the admin creates a platform topic and grants a sender, and the sender creates a topic for one permit', async () => {
    const sender = await senderWithCredential(t, issuer, adminToken, 'wildfire');
    const created = await t
      .http()
      .post('/api/v1/admin/topics')
      .set(admin)
      .send({ key: 'wildfire-alerts', name: 'Wildfire alerts', selfSubscribe: true });
    expect(created.status).toBe(201);
    const alerts = String(created.body.id);

    const granted = await t.http().put(broadcasterPath(alerts, sender.id)).set(admin);
    const permit = await t
      .http()
      .post('/api/v1/topics')
      .set(sender.credential)
      .send({ key: 'permit-1234', name: 'Permit 1234' });

    expect(granted.status).toBe(200);
    expect(granted.body).toEqual({
      id: alerts,
      key: 'wildfire-alerts',
      name: 'Wildfire alerts',
      scope: 'platform',
      selfSubscribe: true,
      broadcasters: [sender.id],
    });
    expect(permit.status).toBe(201);
    const permitTopic = { id: permit.body.id, key: 'permit-1234', name: 'Permit 1234', scope: 'sender' };
    // Topics are closed to self-subscription unless created open (R17).
    expect(permit.body).toEqual({ ...permitTopic, selfSubscribe: false });

    const list = await t.http().get('/api/v1/topics').set(sender.credential);
    expect(list.body).toEqual([
      { ...permitTopic, selfSubscribe: false },
      { id: alerts, key: 'wildfire-alerts', name: 'Wildfire alerts', scope: 'platform', selfSubscribe: true },
    ]);
    expect([await canBroadcast(sender.id, alerts), await canBroadcast(sender.id, String(permit.body.id))]).toEqual([
      true,
      true,
    ]);
  });
});

describe('broadcast permission (R15, R16)', () => {
  it('a sender without a broadcast grant cannot see or broadcast to a platform topic', async () => {
    const [granted, ungranted] = await Promise.all([
      senderWithCredential(t, issuer, adminToken, 'roads'),
      senderWithCredential(t, issuer, adminToken, 'rail'),
    ]);
    const closures = await platformTopic('road-closures');
    expect((await t.http().put(broadcasterPath(closures, granted.id)).set(admin)).status).toBe(200);

    const [read, list] = await Promise.all([
      t.http().get(`/api/v1/topics/${closures}`).set(ungranted.credential),
      t.http().get('/api/v1/topics').set(ungranted.credential),
    ]);

    expect(read.status).toBe(404);
    expect(list.body).toEqual([]);
    expect(await canBroadcast(ungranted.id, closures)).toBe(false);
    expect(await canBroadcast(granted.id, closures)).toBe(true);
  });

  it('revoking the grant ends the sender’s permission to broadcast', async () => {
    const sender = await senderWithCredential(t, issuer, adminToken, 'ferries');
    const sailings = await platformTopic('sailings');
    await t.http().put(broadcasterPath(sailings, sender.id)).set(admin);

    const revoked = await t.http().delete(broadcasterPath(sailings, sender.id)).set(admin);

    expect(revoked.status).toBe(200);
    expect(revoked.body.broadcasters).toEqual([]);
    expect(await canBroadcast(sender.id, sailings)).toBe(false);
    expect((await t.http().get(`/api/v1/topics/${sailings}`).set(sender.credential)).status).toBe(404);
  });

  it('sender A cannot see or broadcast to sender B’s topics, even with the same key', async () => {
    const [a, b] = await Promise.all([
      senderWithCredential(t, issuer, adminToken, 'fish'),
      senderWithCredential(t, issuer, adminToken, 'hunt'),
    ]);
    const [topicA, topicB] = await Promise.all([senderTopic(a, 'permit-1'), senderTopic(b, 'permit-1')]);

    const [readB, listA] = await Promise.all([
      t.http().get(`/api/v1/topics/${topicB}`).set(a.credential),
      t.http().get('/api/v1/topics').set(a.credential),
    ]);

    expect(readB.status).toBe(404);
    expect(listA.body.map((topic: { id: string }) => topic.id)).toEqual([topicA]);
    expect(await canBroadcast(a.id, topicB)).toBe(false);
    expect(await canBroadcast(b.id, topicB)).toBe(true);
  });

  it('the admin cannot grant broadcast to a sender topic', async () => {
    const [owner, other] = await Promise.all([
      senderWithCredential(t, issuer, adminToken, 'mines'),
      senderWithCredential(t, issuer, adminToken, 'quarries'),
    ]);
    const topic = await senderTopic(owner, 'mine-7');

    const res = await t.http().put(broadcasterPath(topic, other.id)).set(admin);

    expect(res.status).toBe(404);
    expect(await canBroadcast(other.id, topic)).toBe(false);
  });
});

describe('topic keys and access', () => {
  it('refuses a key already used among platform topics, or within the same sender', async () => {
    const sender = await senderWithCredential(t, issuer, adminToken, 'parks');
    await Promise.all([platformTopic('park-alerts'), senderTopic(sender, 'campsite-9')]);

    const [platform, own] = await Promise.all([
      t.http().post('/api/v1/admin/topics').set(admin).send({ key: 'park-alerts', name: 'Again' }),
      t.http().post('/api/v1/topics').set(sender.credential).send({ key: 'campsite-9', name: 'Again' }),
    ]);

    expect([platform.status, own.status]).toEqual([409, 409]);
  });

  it('only an admin manages platform topics, and only a credential creates sender topics', async () => {
    const sender = await senderWithCredential(t, issuer, adminToken, 'water');
    const topic = await platformTopic('water-advisories');

    const [ownerCreate, ownerGrant, credentialCreate, adminSenderTopic] = await Promise.all([
      t.http().post('/api/v1/admin/topics').set(bearer(sender.ownerToken)).send({ key: 'x', name: 'x' }),
      t.http().put(broadcasterPath(topic, sender.id)).set(bearer(sender.ownerToken)),
      t.http().post('/api/v1/admin/topics').set(sender.credential).send({ key: 'y', name: 'y' }),
      t.http().post('/api/v1/topics').set(admin).send({ key: 'z', name: 'z' }),
    ]);

    expect([ownerCreate.status, ownerGrant.status, credentialCreate.status, adminSenderTopic.status]).toEqual([
      403, 403, 403, 403,
    ]);
    expect(await canBroadcast(sender.id, topic)).toBe(false);
  });
});
