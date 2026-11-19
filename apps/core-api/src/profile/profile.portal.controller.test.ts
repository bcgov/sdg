import { Logger } from '@nestjs/common';
import { identities, principals } from '@repo/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';

const PROFILE = '/api/v1/portal/profile';

describe('GET /api/v1/portal/profile (R17, KTD1, KTD3, KTD8)', () => {
  let t: TestApp;

  const get = (token?: string) => {
    const request = t.http().get(PROFILE);
    return token === undefined ? request : request.set('Authorization', `Bearer ${token}`);
  };
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

  it('Should answer the resident’s live profile, normalized, from userinfo', async () => {
    t.idp.profile = {
      ...t.idp.profile,
      phone_number: '+1 250 555 0100',
      birthdate: '1815-12-10',
      gender: 'female',
      address: { formatted: '12 St James Sq\nLondon SW1Y 4JH' },
    };
    const res = await get(await t.idp.portalToken());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phoneNumber: '+1 250 555 0100',
      birthdate: '1815-12-10',
      gender: 'female',
      address: ['12 St James Sq', 'London SW1Y 4JH'],
    });
    expect(t.idp.userinfoRequests).toBe(1);
  });

  it('Should answer null for the profile claims userinfo does not release', async () => {
    const res = await get(await t.idp.portalToken());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phoneNumber: null,
      birthdate: null,
      gender: null,
      address: null,
    });
  });

  it('Should store nothing', async () => {
    t.idp.profile = { ...t.idp.profile, birthdate: '1815-12-10' };
    expect((await get(await t.idp.portalToken())).status).toBe(200);
    expect(await rowCounts()).toEqual({ principals: 0, identities: 0 });
  });

  it('Should warn, naming only the keys, when the token carries profile claims (KTD8)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      expect((await get(await t.idp.portalToken({ birthdate: '1815-12-10' }))).status).toBe(200);
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ claims: ['birthdate'] }));
      expect(JSON.stringify(warn.mock.calls)).not.toContain('1815-12-10');
    } finally {
      warn.mockRestore();
    }
  });

  it('Should answer 403 to console-client and service-account tokens, and 401 without a token', async () => {
    expect((await get(await t.idp.consoleToken(['admin']))).status).toBe(403);
    expect((await get(await t.idp.serviceAccountToken())).status).toBe(403);
    expect((await get()).status).toBe(401);
    expect(t.idp.userinfoRequests).toBe(0);
  });

  it('Should answer 503 when userinfo is unreachable or answers for another subject', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      t.idp.userinfoMode = 'down';
      expect((await get(await t.idp.portalToken())).status).toBe(503);
      t.idp.userinfoMode = 'wrong-subject';
      expect((await get(await t.idp.portalToken())).status).toBe(503);
    } finally {
      error.mockRestore();
    }
  });

  it('Should answer 401 when Keycloak refuses the token at userinfo', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      t.idp.userinfoMode = 'reject';
      expect((await get(await t.idp.portalToken())).status).toBe(401);
    } finally {
      warn.mockRestore();
    }
  });
});
