import { identities, principals } from '@repo/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';

const LOGIN = '/internal/principals/login';

describe('POST /internal/principals/login (KTD5, KTD6)', () => {
  let t: TestApp;

  const login = (token: string) => t.http().post(LOGIN).set('Authorization', `Bearer ${token}`);
  const rowCounts = async () => ({
    principals: await t.database.db.$count(principals),
    identities: await t.database.db.$count(identities),
  });

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    t.idp.reset();
    await t.database.db.delete(principals);
  });

  it('Should create the principal and identity from a portal token, with the name from userinfo', async () => {
    const res = await login(await t.idp.portalToken());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ principalId: expect.any(String), name: 'Ada Lovelace', email: 'ada@example.com' });
    const [principal] = await t.database.db.select().from(principals);
    const [identity] = await t.database.db.select().from(identities);
    expect(principal).toMatchObject({ id: res.body.principalId, displayName: 'Ada Lovelace' });
    expect(identity).toMatchObject({ issuer: t.idp.issuer, subject: 'resident-1', username: 'ada@bcsc' });
  });

  it('Should keep the same principal on a second login and refresh its fields', async () => {
    const first = await login(await t.idp.portalToken());
    t.idp.profile = { ...t.idp.profile, name: 'Ada King', email: 'ada.king@example.com' };
    const second = await login(await t.idp.portalToken());
    expect(second.status).toBe(200);
    expect(second.body).toEqual({
      principalId: first.body.principalId,
      name: 'Ada King',
      email: 'ada.king@example.com',
    });
    expect(await rowCounts()).toEqual({ principals: 1, identities: 1 });
  });

  it('Should never persist access, refresh or ID tokens among the claims', async () => {
    t.idp.profile = { ...t.idp.profile, access_token: 'a', refresh_token: 'r', id_token: 'i' };
    const token = await t.idp.portalToken();
    expect((await login(token)).status).toBe(200);
    const [identity] = await t.database.db.select().from(identities);
    const stored = JSON.stringify(identity?.claims);
    expect(stored).not.toMatch(/access_token|refresh_token|id_token/);
    expect(stored).not.toContain(token);
  });

  it('Should answer 403 to an admin-client token without the admin role, and create nothing (AE1)', async () => {
    const res = await login(await t.idp.adminToken(['viewer']));
    expect(res.status).toBe(403);
    expect(await rowCounts()).toEqual({ principals: 0, identities: 0 });
    expect(t.idp.userinfoRequests).toBe(0);
  });

  it('Should create a principal for an admin-client token with the admin role', async () => {
    const res = await login(await t.idp.adminToken(['admin']));
    expect(res.status).toBe(200);
    const [identity] = await t.database.db.select().from(identities);
    expect(identity).toMatchObject({ principalId: res.body.principalId, subject: 'idir-1' });
  });

  it('Should answer 403 to a service-account token', async () => {
    const res = await login(await t.idp.serviceAccountToken());
    expect(res.status).toBe(403);
    expect(await rowCounts()).toEqual({ principals: 0, identities: 0 });
  });

  it('Should answer 401 to a missing, invalid or unknown-client token', async () => {
    expect((await t.http().post(LOGIN)).status).toBe(401);
    expect((await login('not-a-jwt')).status).toBe(401);
    expect((await login(await t.idp.unknownClientToken())).status).toBe(401);
  });

  it('Should answer 503 and create nothing when userinfo is unreachable', async () => {
    t.idp.userinfoMode = 'down';
    const res = await login(await t.idp.portalToken());
    expect(res.status).toBe(503);
    expect(await rowCounts()).toEqual({ principals: 0, identities: 0 });
  });

  it('Should answer 401 and create nothing when Keycloak refuses the token at userinfo', async () => {
    t.idp.userinfoMode = 'reject';
    expect((await login(await t.idp.portalToken())).status).toBe(401);
    expect(await rowCounts()).toEqual({ principals: 0, identities: 0 });
  });

  it('Should answer 503 and create nothing when userinfo answers for another subject', async () => {
    t.idp.userinfoMode = 'wrong-subject';
    expect((await login(await t.idp.portalToken())).status).toBe(503);
    expect(await rowCounts()).toEqual({ principals: 0, identities: 0 });
  });

  it('Should not be served under /api, which a forwarder could reach', async () => {
    expect(
      (
        await t
          .http()
          .post(`/api${LOGIN}`)
          .set('Authorization', `Bearer ${await t.idp.portalToken()}`)
      ).status,
    ).toBe(404);
  });
});
