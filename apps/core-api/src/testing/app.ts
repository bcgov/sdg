import 'reflect-metadata';
import type { Type } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { configureApp } from '@repo/server-core/nestjs';
import supertest from 'supertest';
import { vi } from 'vitest';

import { AUTH_FETCH } from '../auth/auth.module.js';
import { swaggerOptions } from '../openapi/swagger-options.js';
import { createTestDatabase, type TestDatabase } from './database.js';
import { ADMIN_CLIENT_ID, PORTAL_CLIENT_ID, startTestIdp, type TestIdp } from './idp.js';

export interface TestApp {
  app: NestExpressApplication;
  http: () => supertest.Agent;
  idp: TestIdp;
  database: TestDatabase;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  /** Extra controllers mounted on the real AppModule (e.g. probes behind the portal and admin guards). */
  controllers?: Type[];
  /** Env overrides on top of the test env. */
  env?: Record<string, string>;
  /** Runs before the app starts, e.g. to make the JWKS unreachable before anything caches it. */
  prepareIdp?: (idp: TestIdp) => void;
}

/**
 * The real AppModule and HTTP conventions, with Postgres swapped for PGlite (real migrations) and Keycloak for the
 * `@repo/auth` fake IdP plus a userinfo endpoint (`startTestIdp`).
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const idp = await startTestIdp();
  options.prepareIdp?.(idp);
  const env = {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://core:core@localhost:5432/portal_test',
    KEYCLOAK_ISSUER_URL: idp.issuer,
    PORTAL_CLIENT_ID,
    ADMIN_CLIENT_ID,
    ...options.env,
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  // ConfigModule.forRoot reads the environment when the module is defined, so import after stubbing.
  const { AppModule, UNPREFIXED_ROUTES } = await import('../app.module.js');
  const database = await createTestDatabase();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: options.controllers ?? [] })
    .overrideProvider(getDrizzleToken())
    .useValue(database.db)
    .overrideProvider(AUTH_FETCH)
    .useValue(idp.fetch)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, { swagger: swaggerOptions, unprefixed: UNPREFIXED_ROUTES });
  await app.init();

  return {
    app,
    http: () => supertest.agent(app.getHttpServer()),
    idp,
    database,
    close: async () => {
      await app.close();
      await Promise.all([database.close(), idp.close()]);
      vi.unstubAllEnvs();
    },
  };
}
