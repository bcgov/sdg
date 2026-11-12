import { Logger } from '@nestjs/common';
import { startFakeIdp, type FakeIdp } from '@repo/auth/testing';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createBffTestApp, signIn, type BffTestApp } from '../test-support/bff-app.js';
import { createTestSessionDatabase, type TestSessionDatabase } from '../test-support/database.js';
import { startCoreApiStub, type CoreApiStub } from '../testing/core-api-stub.js';
import { SESSION_POOL } from './bff.options.js';

describe('BffModule', () => {
  let idp: FakeIdp;
  let coreApi: CoreApiStub;
  let database: TestSessionDatabase;
  let portal: BffTestApp;
  let consoleApp: BffTestApp;

  beforeAll(async () => {
    [idp, coreApi, database] = await Promise.all([startFakeIdp(), startCoreApiStub(), createTestSessionDatabase()]);
    // Both on one sessions table with one SESSION_SECRET: the worst case, where only the cookie name and HKDF info
    // keep them apart. In production each BFF also has its own login and schema.
    [portal, consoleApp] = await Promise.all([
      createBffTestApp({ idp, coreApi, database }),
      createBffTestApp({
        idp,
        coreApi,
        database,
        overrides: {
          session: {
            cookieName: 'console.sid',
            secret: 'test-session-secret-at-least-32-characters',
            keyInfo: 'console-session-store',
            ttlSeconds: 3600,
          },
          audiences: ['console'],
        },
      }),
    ]);
  }, 60_000);

  afterAll(async () => {
    await Promise.all([portal.close(), consoleApp.close()]);
    await Promise.all([idp.close(), coreApi.close(), database.close()]);
  });

  it('gives each BFF its own session cookie', async () => {
    const { cookie: portalCookie } = await signIn(portal, idp);
    const { cookie: consoleCookie } = await signIn(consoleApp, idp);
    expect(portalCookie).toMatch(/^portal\.sid=/);
    expect(consoleCookie).toMatch(/^console\.sid=/);
    expect((await consoleApp.http().get('/api/auth/me').set('cookie', consoleCookie)).status).toBe(200);
  });

  it("does not accept the other BFF's session, under either cookie name", async () => {
    const { cookie } = await signIn(portal, idp);
    const value = cookie.slice('portal.sid='.length);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect((await consoleApp.http().get('/api/auth/me').set('cookie', cookie)).status).toBe(401);
    // Even renamed, the payload was sealed with the portal key, so the console store cannot read the row.
    expect((await consoleApp.http().get('/api/auth/me').set('cookie', `console.sid=${value}`)).status).toBe(401);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ msg: 'Discarding unreadable session' }));
    expect((await portal.http().get('/api/auth/me').set('cookie', cookie)).status).toBe(200);
    warn.mockRestore();
  });

  it('forwards only its own audiences plus shared', async () => {
    const { cookie } = await signIn(consoleApp, idp);
    coreApi.reset();
    const get = (path: string) => consoleApp.http().get(path).set('cookie', cookie);
    expect((await get('/api/v1/console/service-clients')).status).toBe(200);
    expect((await get('/api/v1/shared/x')).status).toBe(200);
    expect((await get('/api/v1/portal/x')).status).toBe(404);
    expect(coreApi.received.map(({ url }) => url)).toEqual(['/api/v1/console/service-clients', '/api/v1/shared/x']);
  });

  it('documents the auth routes with the session scheme and leaves the forwarder out of OpenAPI', async () => {
    const res = await portal.http().get('/api/docs-json');
    expect(res.status).toBe(200);
    const paths: Record<string, Record<string, { security?: unknown }>> = res.body.paths;
    expect(Object.keys(paths).toSorted()).toEqual([
      '/api/auth/callback',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/me',
    ]);
    expect(paths['/api/auth/me']?.['get']?.security).toEqual([{ session: [] }]);
  });

  it("logs an idle client's error on its pool instead of crashing the process", () => {
    const pool = portal.app.get<Pool>(SESSION_POOL);
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const dropped = new Error('terminating connection due to administrator command');
    try {
      // pg emits this when Postgres closes an idle pooled connection (restart, Patroni switchover).
      expect(() => pool.emit('error', dropped)).not.toThrow();
      expect(error).toHaveBeenCalledWith({
        msg: 'Idle Postgres client error',
        error: expect.objectContaining({ type: 'Error', message: dropped.message }),
      });
    } finally {
      error.mockRestore();
    }
  });

  it('ends its pool on shutdown', async () => {
    const extra = await createBffTestApp({ idp, coreApi, database });
    const pool = extra.app.get<Pool>(SESSION_POOL);
    expect(pool.ended).toBe(false);
    await extra.close();
    expect(pool.ended).toBe(true);
  });
});
