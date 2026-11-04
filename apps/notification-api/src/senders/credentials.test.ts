import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';
import { bearer, createSender, CREDENTIAL_PROBE, CredentialProbeController } from '../testing/senders.js';
import { OWN_CLIENT_ID, RELAYING_CLIENT_ID, startTestIssuer, type TestIssuer } from '../testing/tokens.js';

let t: TestApp;
let issuer: TestIssuer;
let adminToken: string;

beforeAll(async () => {
  issuer = await startTestIssuer();
  t = await createTestApp({ env: issuer.env, issuerFetch: issuer.fetch, controllers: [CredentialProbeController] });
  adminToken = await issuer.ownClientUserToken({ admin: true });
});

afterAll(async () => {
  await t.close();
  await issuer.close();
});

const credentialsPath = (senderId: string) => `/api/v1/senders/${senderId}/credentials`;

async function link(senderId: string, ownerToken: string, clientId: string): Promise<string> {
  const res = await t.http().post(credentialsPath(senderId)).set(bearer(ownerToken)).send({ clientId });
  expect(res.status).toBe(201);
  return String(res.body.id);
}

async function scope(senderId: string, ownerToken: string, credentialId: string, typeKeys: string[]) {
  return t
    .http()
    .put(`${credentialsPath(senderId)}/${credentialId}/scopes`)
    .set(bearer(ownerToken))
    .send({ typeKeys });
}

/** What the credential guard resolves for a client's client-credentials token. */
async function probe(clientId: string) {
  return t
    .http()
    .get(CREDENTIAL_PROBE)
    .set(bearer(await issuer.credentialToken(clientId)));
}

describe('F5: sender credential setup', () => {
  it('an owner links two credentials to a sender granted three types and scopes one to a single type', async () => {
    const types = ['permit-approved', 'permit-expired', 'permit-rejected'];
    const sender = await createSender(t, issuer, adminToken, { name: 'Permits', owner: 'permits-owner', types });

    const batch = await link(sender.id, sender.ownerToken, 'permits-batch');
    const portal = await link(sender.id, sender.ownerToken, 'permits-portal');
    const scoped = await scope(sender.id, sender.ownerToken, batch, ['permit-approved']);

    expect(scoped.status).toBe(200);
    expect(scoped.body).toEqual({ id: batch, clientId: 'permits-batch', scopedTypes: ['permit-approved'] });
    const list = await t.http().get(credentialsPath(sender.id)).set(bearer(sender.ownerToken));
    expect(list.body).toEqual([
      { id: batch, clientId: 'permits-batch', scopedTypes: ['permit-approved'] },
      { id: portal, clientId: 'permits-portal', scopedTypes: [] },
    ]);

    // The credential guard reads the link from the database: its sender, credential and scoped types.
    const resolved = await probe('permits-batch');
    expect(resolved.status).toBe(200);
    expect(resolved.body).toEqual({ senderId: sender.id, credentialId: batch, scopedTypes: ['permit-approved'] });
  });

  it('an admin manages any sender’s credentials, and an unlinked client is no longer a credential', async () => {
    const sender = await createSender(t, issuer, adminToken, { name: 'Roads', owner: 'roads-owner' });
    const id = await link(sender.id, adminToken, 'roads-sync');
    expect((await probe('roads-sync')).status).toBe(200);

    const unlinked = await t
      .http()
      .delete(`${credentialsPath(sender.id)}/${id}`)
      .set(bearer(adminToken));

    expect(unlinked.status).toBe(204);
    expect((await probe('roads-sync')).status).toBe(401);
  });
});

describe('credential scopes', () => {
  it('rejects scoping a credential to a type the sender was not granted, and keeps its scope', async () => {
    const sender = await createSender(t, issuer, adminToken, {
      name: 'Parks',
      owner: 'parks-owner',
      types: ['park-pass'],
    });
    const id = await link(sender.id, sender.ownerToken, 'parks-sender');
    await scope(sender.id, sender.ownerToken, id, ['park-pass']);

    const rejected = await scope(sender.id, sender.ownerToken, id, ['park-pass', 'fishing-licence']);

    expect(rejected.status).toBe(400);
    expect(rejected.body.message).toContain('fishing-licence');
    const read = await t
      .http()
      .get(`${credentialsPath(sender.id)}/${id}`)
      .set(bearer(sender.ownerToken));
    expect(read.body.scopedTypes).toEqual(['park-pass']);
  });

  it("revoking a granted type removes it from every one of that sender's credentials", async () => {
    const [sender, other] = await Promise.all([
      createSender(t, issuer, adminToken, { name: 'Fish', owner: 'fish-owner', types: ['catch', 'licence'] }),
      createSender(t, issuer, adminToken, { name: 'Hunt', owner: 'hunt-owner', types: ['catch'] }),
    ]);
    const [first, second, others] = await Promise.all([
      link(sender.id, sender.ownerToken, 'fish-first'),
      link(sender.id, sender.ownerToken, 'fish-second'),
      link(other.id, other.ownerToken, 'hunt-only'),
    ]);
    await Promise.all([
      scope(sender.id, sender.ownerToken, first, ['catch', 'licence']),
      scope(sender.id, sender.ownerToken, second, ['catch']),
      scope(other.id, other.ownerToken, others, ['catch']),
    ]);

    const revoked = await t.http().delete(`/api/v1/admin/senders/${sender.id}/grants/catch`).set(bearer(adminToken));

    expect(revoked.status).toBe(200);
    expect(revoked.body.grantedTypes).toEqual(['licence']);
    const list = await t.http().get(credentialsPath(sender.id)).set(bearer(sender.ownerToken));
    expect(list.body).toEqual([
      { id: first, clientId: 'fish-first', scopedTypes: ['licence'] },
      { id: second, clientId: 'fish-second', scopedTypes: [] },
    ]);
    expect((await probe('fish-first')).body.scopedTypes).toEqual(['licence']);
    // Another sender's grant of the same type is untouched.
    expect((await probe('hunt-only')).body.scopedTypes).toEqual(['catch']);
  });
});

describe('linking credentials', () => {
  it.each([
    ['a relaying client', RELAYING_CLIENT_ID],
    ["notification-api's own client", OWN_CLIENT_ID],
  ])('rejects linking %s', async (_label, clientId) => {
    const sender = await createSender(t, issuer, adminToken, {
      name: `Reserved ${clientId}`,
      owner: `reserved-${clientId}`,
    });

    const res = await t.http().post(credentialsPath(sender.id)).set(bearer(sender.ownerToken)).send({ clientId });

    expect(res.status).toBe(400);
    const list = await t.http().get(credentialsPath(sender.id)).set(bearer(sender.ownerToken));
    expect(list.body).toEqual([]);
  });

  it('rejects linking a client that is already another sender’s credential', async () => {
    const [a, b] = await Promise.all([
      createSender(t, issuer, adminToken, { name: 'Dup A', owner: 'dup-a' }),
      createSender(t, issuer, adminToken, { name: 'Dup B', owner: 'dup-b' }),
    ]);
    await link(b.id, b.ownerToken, 'shared-client');

    const res = await t
      .http()
      .post(credentialsPath(a.id))
      .set(bearer(a.ownerToken))
      .send({ clientId: 'shared-client' });

    expect(res.status).toBe(409);
    expect((await probe('shared-client')).body.senderId).toBe(b.id);
  });
});

describe("another sender's credential", () => {
  it("is a 404 on the owner's own sender path, and is left unchanged", async () => {
    const [a, b] = await Promise.all([
      createSender(t, issuer, adminToken, { name: 'Own A', owner: 'own-a', types: ['shared-type'] }),
      createSender(t, issuer, adminToken, { name: 'Own B', owner: 'own-b', types: ['shared-type'] }),
    ]);
    const bCredential = await link(b.id, b.ownerToken, 'b-credential');
    await scope(b.id, b.ownerToken, bCredential, ['shared-type']);
    const onA = `${credentialsPath(a.id)}/${bCredential}`;
    const asOwnerA = bearer(a.ownerToken);

    const attempts = await Promise.all([
      t.http().get(onA).set(asOwnerA),
      t.http().put(`${onA}/scopes`).set(asOwnerA).send({ typeKeys: [] }),
      t.http().delete(onA).set(asOwnerA),
    ]);

    expect(attempts.map((res) => res.status)).toEqual([404, 404, 404]);
    const read = await t
      .http()
      .get(`${credentialsPath(b.id)}/${bCredential}`)
      .set(bearer(b.ownerToken));
    expect(read.body).toEqual({ id: bCredential, clientId: 'b-credential', scopedTypes: ['shared-type'] });
  });
});
