import {
  bffTestEnv,
  bffTestKit,
  type BffTestApp,
  type BffTestAppOptions,
  type SignedIn,
} from '@repo/bff-core/testing/nestjs';

import { SESSION_COOKIE } from '../bff/portal-session.js';
import { swaggerOptions } from '../openapi/swagger-options.js';
import { createTestDatabase, type TestDatabase } from './database.js';

export type { SignedIn };
export type TestApp = BffTestApp<TestDatabase>;
export type TestAppOptions = BffTestAppOptions;

export const APP_URL = 'http://localhost:5173';
export const TEST_ENV = bffTestEnv(APP_URL, 'portal');

/** The claims the fake IdP puts in the ID token at sign-in; core-api's userinfo profile differs on purpose. */
export const ID_TOKEN_CLAIMS = { sub: 'resident-1', name: 'Ada Lovelace', email: 'ada@example.com' } as const;

/**
 * portal-api's real AppModule against the fake IdP, a core-api stub and PGlite (`createTestApp`), and sign-in through them
 * as ID_TOKEN_CLAIMS (`authorize` stops at the callback query; `signIn` throws unless the `portal.sid` cookie was set).
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
