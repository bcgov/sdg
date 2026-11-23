import type { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { serviceClientEvents, serviceClients } from '@repo/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';
import { SERVICE_CLIENT_ID } from '../testing/idp.js';
import { CurrentServiceClient, type GatewayRequest } from './gateway.guard.js';
import type { ServiceClientView } from './registry.schemas.js';

const ME = '/api/v1/gateway/me';

function getCurrentServiceClientFactory(): (data: unknown, context: ExecutionContext) => ServiceClientView {
  class TestHost {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    endpoint(@CurrentServiceClient() _entry: unknown) {}
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- custom route argument metadata reflects the factory function.
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestHost, 'endpoint') as Record<
    string,
    { factory: (data: unknown, context: ExecutionContext) => ServiceClientView }
  >;
  const key = Object.keys(meta)[0];
  if (key === undefined || meta[key] === undefined) throw new Error('Missing parameter decorator factory');
  return meta[key].factory;
}

function mockContext(request: GatewayRequest): ExecutionContext {
  const http = { getRequest: () => request };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the decorator only calls switchToHttp().getRequest().
  return { switchToHttp: () => http } as unknown as ExecutionContext;
}

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

describe('CurrentServiceClient decorator', () => {
  const factory = getCurrentServiceClientFactory();

  it('Should extract the serviceClient when present on the request', () => {
    const serviceClient: ServiceClientView = {
      clientId: SERVICE_CLIENT_ID,
      displayName: 'Partner',
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const ctx = mockContext({ headers: {}, serviceClient });
    expect(factory(undefined, ctx)).toBe(serviceClient);
  });

  it('Should throw when used on a request without GatewayGuard (serviceClient is undefined)', () => {
    const ctx = mockContext({ headers: {} });
    expect(() => factory(undefined, ctx)).toThrow('@CurrentServiceClient() used on a route without GatewayGuard');
  });
});
