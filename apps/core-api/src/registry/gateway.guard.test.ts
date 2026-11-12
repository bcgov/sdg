import { serviceClientEvents, serviceClients } from '@repo/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';
import { SERVICE_CLIENT_ID } from '../testing/idp.js';

const ME = '/api/v1/gateway/me';

describe('Gateway route /api/v1/gateway/me behind GatewayGuard (R9, R20, R21, R22)', () => {
  let t: TestApp;

  const call = (token: string) => t.http().get(ME).set('Authorization', `Bearer ${token}`);
  const register = (enabled = true) =>
    t.database.db.insert(serviceClients).values({ clientId: SERVICE_CLIENT_ID, displayName: 'Partner', enabled });

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    t.idp.reset();
    await Promise.all([t.database.db.delete(serviceClients), t.database.db.delete(serviceClientEvents)]);
  });

  it('Should return an enabled client its own registry entry (R22)', async () => {
    await register();
    const res = await call(await t.idp.serviceAccountToken());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      clientId: SERVICE_CLIENT_ID,
      displayName: 'Partner',
      enabled: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('Should answer 403 to a client disabled after its token was issued (AE3, R21)', async () => {
    await register();
    const token = await t.idp.serviceAccountToken();
    expect((await call(token)).status).toBe(200);
    await t.database.db.update(serviceClients).set({ enabled: false });
    expect((await call(token)).status).toBe(403);
  });

  it('Should answer 403 to a client removed after its token was issued (R21)', async () => {
    await register();
    const token = await t.idp.serviceAccountToken();
    expect((await call(token)).status).toBe(200);
    await t.database.db.delete(serviceClients);
    expect((await call(token)).status).toBe(403);
  });

  it('Should answer 403 to a valid token from an unregistered service account (AE4)', async () => {
    await register();
    expect((await call(await t.idp.serviceAccountToken('stranger-client'))).status).toBe(403);
  });

  it('Should answer 401 to an expired token from a registered client (AE4)', async () => {
    await register();
    expect((await call(await t.idp.serviceAccountToken(SERVICE_CLIENT_ID, { expiresIn: '-5m' }))).status).toBe(401);
  });

  it('Should answer 401 to a person token whose azp is a registered client id', async () => {
    await register();
    const person = await t.idp.idp.sign({ sub: 'resident-1', azp: SERVICE_CLIENT_ID }, { audience: 'account' });
    expect((await call(person)).status).toBe(401);
  });

  it('Should answer 403 to portal and console person tokens', async () => {
    expect((await call(await t.idp.portalToken())).status).toBe(403);
    expect((await call(await t.idp.consoleToken(['admin']))).status).toBe(403);
  });

  it('Should answer 401 without a token', async () => {
    expect((await t.http().get(ME)).status).toBe(401);
  });
});
