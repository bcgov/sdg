import { bffTestEnv, bffTestKit, type BffTestApp, type BffTestAppOptions } from '@repo/bff-core/testing/nestjs';

import { SESSION_COOKIE } from '../bff/admin-session.js';
import { swaggerOptions } from '../openapi/swagger-options.js';
import { createTestDatabase, type TestDatabase } from './database.js';

export type { SignedIn } from '@repo/bff-core/testing/nestjs';
export type TestApp = BffTestApp<TestDatabase>;
export type TestAppOptions = BffTestAppOptions;

export const APP_URL = 'http://localhost:5174';
export const TEST_ENV = bffTestEnv(APP_URL, 'admin');

/** The claims the fake IdP puts in the ID token at sign-in; core-api's userinfo profile differs on purpose. */
export const ID_TOKEN_CLAIMS = { sub: 'idir-admin-1', name: 'Grace Hopper', email: 'grace@example.gov.bc.ca' } as const;

/**
 * admin-api's real AppModule against the fake IdP, a core-api stub and PGlite (`createTestApp`), and sign-in through them
 * as ID_TOKEN_CLAIMS (`authorize` stops at the callback query; `signIn` throws unless the `admin.sid` cookie was set).
 */
export const { createTestApp, authorize, signIn } = bffTestKit({
  appUrl: APP_URL,
  env: TEST_ENV,
  loadAppModule: async () => (await import('../app.module.js')).AppModule,
  createDatabase: createTestDatabase,
  swagger: swaggerOptions,
  cookieName: SESSION_COOKIE,
  claims: ID_TOKEN_CLAIMS,
});
