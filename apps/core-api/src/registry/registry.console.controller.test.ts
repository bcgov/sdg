import { principals, serviceClientEvents, serviceClients } from '@repo/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';
import { CONSOLE_CLIENT_ID, PORTAL_CLIENT_ID } from '../testing/idp.js';

const BASE = '/api/v1/console/service-clients';

describe('Console registry routes /api/v1/console/service-clients (R16, R17, F3)', () => {
  let t: TestApp;
  let token: string;
  let consolePrincipalId: string;

  const auth = (request: ReturnType<ReturnType<TestApp['http']>['get']>, bearer = token) =>
    request.set('Authorization', `Bearer ${bearer}`);
  const add = (body: object, bearer = token) => auth(t.http().post(BASE), bearer).send(body);
  const history = async () => (await auth(t.http().get(`${BASE}/history`))).body.events;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    t.idp.reset();
    await Promise.all([
      t.database.db.delete(principals),
      t.database.db.delete(serviceClients),
      t.database.db.delete(serviceClientEvents),
    ]);
    token = await t.idp.consoleToken(['admin']);
    // The administrator signs in through console-api first, which creates their principal.
    const login = await t.http().post('/internal/principals/login').set('Authorization', `Bearer ${token}`);
    if (login.status !== 200) throw new Error(`Console sign-in failed with HTTP ${login.status}`);
    consolePrincipalId = login.body.principalId;
  });

  it('Should add a client with 201 and record who added it (F3)', async () => {
    const res = await add({ clientId: 'partner-client', displayName: 'Partner' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      clientId: 'partner-client',
      displayName: 'Partner',
      enabled: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(await history()).toEqual([
      {
        id: expect.any(Number),
        clientId: 'partner-client',
        action: 'added',
        actor: { principalId: consolePrincipalId, name: 'Ada Lovelace' },
        createdAt: expect.any(String),
      },
    ]);
  });

  it('Should list registered clients', async () => {
    await add({ clientId: 'partner-client', displayName: 'Partner' });
    const res = await auth(t.http().get(BASE));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([expect.objectContaining({ clientId: 'partner-client', enabled: true })]);
  });

  it('Should answer 409 to an existing client id and record no event', async () => {
    await add({ clientId: 'partner-client', displayName: 'Partner' });
    expect((await add({ clientId: 'partner-client', displayName: 'Again' })).status).toBe(409);
    expect(await history()).toHaveLength(1);
  });

  it.each([
    ['the portal client id', { clientId: PORTAL_CLIENT_ID, displayName: 'Portal' }],
    ['the console client id', { clientId: CONSOLE_CLIENT_ID, displayName: 'Console' }],
    ['a malformed client id', { clientId: 'has spaces/and slashes', displayName: 'Bad' }],
    ['an empty display name', { clientId: 'partner-client', displayName: '   ' }],
    ['a missing display name', { clientId: 'partner-client' }],
  ])('Should answer 400 to %s', async (_case, body) => {
    expect((await add(body)).status).toBe(400);
    expect(await t.database.db.$count(serviceClients)).toBe(0);
  });

  it('Should disable once with an event, and answer 200 with no new event when already disabled', async () => {
    await add({ clientId: 'partner-client', displayName: 'Partner' });
    const first = await auth(t.http().post(`${BASE}/partner-client/disable`));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ clientId: 'partner-client', enabled: false });
    const again = await auth(t.http().post(`${BASE}/partner-client/disable`));
    expect(again.status).toBe(200);
    expect((await history()).map((event: { action: string }) => event.action)).toEqual(['disabled', 'added']);

    const enabled = await auth(t.http().post(`${BASE}/partner-client/enable`));
    expect(enabled.body).toMatchObject({ enabled: true });
    expect((await history())[0]).toMatchObject({ action: 'enabled' });
  });

  it('Should remove with 204, keep the earlier history and record the removal', async () => {
    await add({ clientId: 'partner-client', displayName: 'Partner' });
    const res = await auth(t.http().delete(`${BASE}/partner-client`));
    expect(res.status).toBe(204);
    expect((await auth(t.http().get(BASE))).body).toEqual([]);
    expect((await history()).map((event: { action: string }) => event.action)).toEqual(['removed', 'added']);
  });

  it('Should continue the history when a removed client id is added again', async () => {
    await add({ clientId: 'partner-client', displayName: 'Partner' });
    await auth(t.http().delete(`${BASE}/partner-client`));
    expect((await add({ clientId: 'partner-client', displayName: 'Partner' })).status).toBe(201);
    expect((await history()).map((event: { action: string }) => event.action)).toEqual(['added', 'removed', 'added']);
  });

  it('Should answer 404 to changes on a missing client', async () => {
    expect((await auth(t.http().post(`${BASE}/ghost/disable`))).status).toBe(404);
    expect((await auth(t.http().post(`${BASE}/ghost/enable`))).status).toBe(404);
    expect((await auth(t.http().delete(`${BASE}/ghost`))).status).toBe(404);
    expect(await history()).toEqual([]);
  });

  it('Should answer 400 to a malformed client id in the path', async () => {
    expect((await auth(t.http().post(`${BASE}/bad%20id/disable`))).status).toBe(400);
  });

  it('Should page the history with limit and before', async () => {
    // One at a time: the cursor follows insertion order.
    await add({ clientId: 'a', displayName: 'A' });
    await add({ clientId: 'b', displayName: 'B' });
    await add({ clientId: 'c', displayName: 'C' });
    const first = await auth(t.http().get(`${BASE}/history?limit=2`));
    expect(first.body.events.map((event: { clientId: string }) => event.clientId)).toEqual(['c', 'b']);
    const second = await auth(t.http().get(`${BASE}/history?limit=2&before=${first.body.nextBefore}`));
    expect(second.body).toEqual({ events: [expect.objectContaining({ clientId: 'a' })], nextBefore: null });
    expect((await auth(t.http().get(`${BASE}/history?limit=0`))).status).toBe(400);
  });

  it('Should answer 403 to a portal user and to a console-client user without the admin role', async () => {
    expect((await auth(t.http().get(BASE), await t.idp.portalToken())).status).toBe(403);
    expect((await add({ clientId: 'x', displayName: 'X' }, await t.idp.consoleToken(['viewer']))).status).toBe(403);
    expect((await auth(t.http().get(BASE), await t.idp.serviceAccountToken())).status).toBe(403);
    expect(await t.database.db.$count(serviceClients)).toBe(0);
  });

  it('Should answer 401 without a token', async () => {
    expect((await t.http().get(BASE)).status).toBe(401);
  });

  it('Should answer 403 to a change from an administrator who never signed in, and record nothing', async () => {
    const stranger = await t.idp.consoleToken(['admin'], { sub: 'idir-never-signed-in' });
    expect((await add({ clientId: 'partner-client', displayName: 'Partner' }, stranger)).status).toBe(403);
    expect(await t.database.db.$count(serviceClients)).toBe(0);
  });
});
