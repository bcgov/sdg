import { Controller, Get, UseGuards } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AdminGuard, PortalGuard } from '../../src/auth/audience.guards.js';
import { createTestApp, type TestApp } from '../../src/testing/app.js';
import type { TestIdp } from '../../src/testing/idp.js';

/** Test-only routes in the portal and admin audiences. */
@Controller({ path: 'portal/probe', version: '1' })
@UseGuards(PortalGuard)
class PortalProbeController {
  @Get()
  get(): { audience: string } {
    return { audience: 'portal' };
  }
}

@Controller({ path: 'admin/probe', version: '1' })
@UseGuards(AdminGuard)
class AdminProbeController {
  @Get()
  get(): { audience: string } {
    return { audience: 'admin' };
  }
}

const probes = [PortalProbeController, AdminProbeController];

describe('Authentication and audiences (R8, R9)', () => {
  let t: TestApp;

  const get = (path: string, token: string) => t.http().get(path).set('Authorization', `Bearer ${token}`);
  const signIn = async (token: string) => {
    const res = await t.http().post('/internal/principals/login').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  };

  beforeAll(async () => {
    t = await createTestApp({ controllers: probes });
  });

  afterAll(() => t.close());

  beforeEach(() => t.idp.reset());

  it('Should admit a portal token to portal routes and an admin token with the role to admin routes', async () => {
    expect((await get('/api/v1/portal/probe', await t.idp.portalToken())).body).toEqual({ audience: 'portal' });
    expect((await get('/api/v1/admin/probe', await t.idp.adminToken(['admin']))).body).toEqual({ audience: 'admin' });
  });

  it('Should answer 403 to a portal token on an admin route and an admin token on a portal route', async () => {
    expect((await get('/api/v1/admin/probe', await t.idp.portalToken())).status).toBe(403);
    expect((await get('/api/v1/portal/probe', await t.idp.adminToken(['admin']))).status).toBe(403);
  });

  it('Should answer 403 to an admin-client token without the admin role on an admin route', async () => {
    expect((await get('/api/v1/admin/probe', await t.idp.adminToken([]))).status).toBe(403);
  });

  it('Should answer 403 to a service account on person routes', async () => {
    const token = await t.idp.serviceAccountToken();
    expect((await get('/api/v1/portal/probe', token)).status).toBe(403);
    expect((await get('/api/v1/shared/me', token)).status).toBe(403);
  });

  it('Should answer 401 to a token from an unknown client, an expired token and no token', async () => {
    expect((await get('/api/v1/portal/probe', await t.idp.unknownClientToken())).status).toBe(401);
    const expired = await t.idp.idp.sign({ sub: 'resident-1', azp: 'sdg-portal' }, { expiresIn: '-5m' });
    expect((await get('/api/v1/portal/probe', expired)).status).toBe(401);
    expect((await t.http().get('/api/v1/shared/me')).status).toBe(401);
  });

  describe('GET /api/v1/shared/me', () => {
    it('Should return the principal of a signed-in portal or admin user', async () => {
      await signIn(await t.idp.portalToken());
      const res = await get('/api/v1/shared/me', await t.idp.portalToken());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: expect.any(String), name: 'Ada Lovelace', email: 'ada@example.com' });

      await signIn(await t.idp.adminToken(['admin']));
      const admin = await get('/api/v1/shared/me', await t.idp.adminToken(['admin']));
      expect(admin.status).toBe(200);
      expect(admin.body.id).not.toBe(res.body.id);
    });

    it('Should answer 404 for a person who never signed in', async () => {
      expect((await get('/api/v1/shared/me', await t.idp.portalToken({ sub: 'stranger' }))).status).toBe(404);
    });
  });
});

describe('Signing keys unreachable (R10, AE8)', () => {
  let t: TestApp;
  let tokens: Record<'portal' | 'admin', string>;

  beforeAll(async () => {
    // Before the first request, so no JWKS is cached.
    t = await createTestApp({ controllers: probes, prepareIdp: (idp: TestIdp) => (idp.idp.failJwks = true) });
    tokens = { portal: await t.idp.portalToken(), admin: await t.idp.adminToken(['admin']) };
  });

  afterAll(() => t.close());

  it.each([
    ['POST', '/internal/principals/login', 'portal'],
    ['GET', '/api/v1/shared/me', 'portal'],
    ['GET', '/api/v1/portal/probe', 'portal'],
    ['GET', '/api/v1/admin/probe', 'admin'],
  ] as const)('Should answer 503 to %s %s', async (method, path, token) => {
    const request = method === 'POST' ? t.http().post(path) : t.http().get(path);
    const res = await request.set('Authorization', `Bearer ${tokens[token]}`);
    expect(res.status).toBe(503);
  });

  it('Should answer 503 when discovery fails too, and recover once Keycloak is back', async () => {
    t.idp.idp.failDiscovery = true;
    expect((await t.http().get('/api/v1/portal/probe').set('Authorization', `Bearer ${tokens.portal}`)).status).toBe(
      503,
    );
    t.idp.reset();
    expect((await t.http().get('/api/v1/portal/probe').set('Authorization', `Bearer ${tokens.portal}`)).status).toBe(
      200,
    );
  });
});
