import { ForbiddenException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { identities, principals } from '@repo/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Caller } from '../auth/caller.js';
import { UserinfoClient } from '../auth/userinfo.client.js';
import { createTestApp, type TestApp } from '../testing/app.js';
import { PrincipalsController } from './principals.controller.js';

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

  it('Should never persist the profile claims userinfo releases (R19)', async () => {
    t.idp.profile = {
      ...t.idp.profile,
      birthdate: '1815-12-10',
      gender: 'female',
      address: { formatted: '12 St James Sq' },
      phone_number: '+1 250 555 0100',
      phone_number_verified: true,
    };
    expect((await login(await t.idp.portalToken())).status).toBe(200);
    const [identity] = await t.database.db.select().from(identities);
    expect(identity?.claims).toMatchObject({ email: 'ada@example.com' });
    const stored = JSON.stringify(identity?.claims);
    expect(stored).not.toMatch(/birthdate|gender|address|phone_number/);
    expect(stored).not.toMatch(/1815-12-10|St James|555 0100/);
  });

  it('Should warn, naming only the keys, when a sign-in token carries profile claims, and still sign in (KTD8)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      expect((await login(await t.idp.portalToken({ gender: 'female' }))).status).toBe(200);
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ claims: ['gender'] }));
      expect(JSON.stringify(warn.mock.calls)).not.toContain('female');
    } finally {
      warn.mockRestore();
    }
  });

  it('Should answer 403 to a console-client token without the admin role, and create nothing (AE1)', async () => {
    const res = await login(await t.idp.consoleToken(['viewer']));
    expect(res.status).toBe(403);
    expect(await rowCounts()).toEqual({ principals: 0, identities: 0 });
    expect(t.idp.userinfoRequests).toBe(0);
  });

  it('Should create a principal for a console-client token with the admin role', async () => {
    const res = await login(await t.idp.consoleToken(['admin']));
    expect(res.status).toBe(200);
    const [identity] = await t.database.db.select().from(identities);
    expect(identity).toMatchObject({ principalId: res.body.principalId, subject: 'idir-1' });
  });

  it('Should record a portal sign-in as portal_signed_in_at only (R18)', async () => {
    expect((await login(await t.idp.portalToken())).status).toBe(200);
    const [identity] = await t.database.db.select().from(identities);
    expect(identity?.portalSignedInAt).toBeInstanceOf(Date);
    expect(identity?.consoleSignedInAt).toBeNull();
  });

  it('Should record a console sign-in as console_signed_in_at only (R18)', async () => {
    expect((await login(await t.idp.consoleToken(['admin']))).status).toBe(200);
    const [identity] = await t.database.db.select().from(identities);
    expect(identity?.consoleSignedInAt).toBeInstanceOf(Date);
    expect(identity?.portalSignedInAt).toBeNull();
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

  it('Should throw ForbiddenException directly when caller is a service account', async () => {
    const controller = t.app.get(PrincipalsController);
    const serviceAccountCaller: Caller = {
      kind: 'service-account',
      user: {
        issuer: t.idp.issuer,
        subject: 'svc-1',
        name: 'Service',
        email: 'svc@example.com',
        emailVerified: false,
        username: 'service-account',
        claims: {},
      },
      token: 'service-token',
      clientId: 'service-client',
    };
    await expect(controller.login(serviceAccountCaller)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('Should re-throw when profile lookup fails with an error that is not a UserinfoError', async () => {
    const controller = t.app.get(PrincipalsController);
    const userinfo = t.app.get(UserinfoClient);
    const unexpectedError = new Error('unexpected userinfo failure');
    vi.spyOn(userinfo, 'profile').mockRejectedValueOnce(unexpectedError);

    const portalCaller: Caller = {
      kind: 'portal-user',
      user: {
        issuer: t.idp.issuer,
        subject: 'resident-1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        emailVerified: true,
        username: 'ada@bcsc',
        claims: {},
      },
      token: 'portal-token',
    };
    await expect(controller.login(portalCaller)).rejects.toThrow('unexpected userinfo failure');
  });
});
