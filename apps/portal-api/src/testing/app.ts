import 'reflect-metadata';
import type { Type } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { AuthUser, CallbackResult, OidcClient, PendingAuthorization } from '@repo/auth';
import { OIDC_CLIENT } from '@repo/auth/nestjs';
import session from 'express-session';
import supertest from 'supertest';
import { vi, type Mock } from 'vitest';

import { configureApp } from '../bootstrap.js';
import { SESSION_STORE } from '../session/session.module.js';
import { VALKEY_CLIENT } from '../valkey/valkey.module.js';
import { createTestDatabase, type TestDatabase } from './database.js';

export const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  APP_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://portal:portal@localhost:5432/portal_test',
  VALKEY_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'test-session-secret-at-least-32-characters',
  KEYCLOAK_ISSUER_URL: 'https://keycloak.example.com/realms/portal',
  KEYCLOAK_CLIENT_ID: 'portal',
  KEYCLOAK_CLIENT_SECRET: 'test-client-secret',
} as const;

export const TEST_USER: AuthUser = {
  issuer: TEST_ENV.KEYCLOAK_ISSUER_URL,
  subject: 'sub-123',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  emailVerified: true,
  username: 'ada',
  claims: { iss: TEST_ENV.KEYCLOAK_ISSUER_URL, sub: 'sub-123', name: 'Ada Lovelace' },
};

export interface OidcStub {
  discover: Mock<OidcClient['discover']>;
  createAuthorizationRequest: Mock<OidcClient['createAuthorizationRequest']>;
  handleCallback: Mock<OidcClient['handleCallback']>;
  buildEndSessionUrl: Mock<OidcClient['buildEndSessionUrl']>;
}

export interface ValkeyStub {
  isOpen: boolean;
  isReady: boolean;
  ping: Mock<() => Promise<string>>;
  close: Mock<() => Promise<void>>;
  destroy: Mock<() => void>;
}

export interface TestApp {
  app: NestExpressApplication;
  http: () => supertest.Agent;
  oidc: OidcStub;
  valkey: ValkeyStub;
  database: TestDatabase;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  /** Extra controllers mounted on the real AppModule (e.g. a probe for the global validation pipe). */
  controllers?: Type[];
  /** Env overrides on top of TEST_ENV. */
  env?: Record<string, string>;
}

export function createOidcStub(): OidcStub {
  return {
    discover: vi.fn<OidcClient['discover']>().mockResolvedValue(undefined),
    createAuthorizationRequest: vi.fn<OidcClient['createAuthorizationRequest']>((returnTo) => {
      const pending: PendingAuthorization = {
        state: 'state-1',
        nonce: 'nonce-1',
        codeVerifier: 'verifier-1',
        returnTo,
      };
      const url = new URL(`${TEST_ENV.KEYCLOAK_ISSUER_URL}/protocol/openid-connect/auth`);
      url.searchParams.set('state', pending.state);
      return Promise.resolve({ url, pending });
    }),
    handleCallback: vi.fn<OidcClient['handleCallback']>(() =>
      Promise.resolve<CallbackResult>({
        user: TEST_USER,
        tokens: { idToken: 'id-token', accessToken: 'access-token', refreshToken: 'refresh-token', expiresAt: null },
      }),
    ),
    buildEndSessionUrl: vi.fn<OidcClient['buildEndSessionUrl']>((idToken) => {
      const url = new URL(`${TEST_ENV.KEYCLOAK_ISSUER_URL}/protocol/openid-connect/logout`);
      if (idToken) url.searchParams.set('id_token_hint', idToken);
      return Promise.resolve(url);
    }),
  };
}

/** Restores the default stub behaviour (and clears calls) between tests. */
export function resetOidcStub(stub: OidcStub): void {
  const fresh = createOidcStub();
  stub.discover.mockReset().mockImplementation(fresh.discover);
  stub.createAuthorizationRequest.mockReset().mockImplementation(fresh.createAuthorizationRequest);
  stub.handleCallback.mockReset().mockImplementation(fresh.handleCallback);
  stub.buildEndSessionUrl.mockReset().mockImplementation(fresh.buildEndSessionUrl);
}

/**
 * The real AppModule and HTTP conventions, with Postgres swapped for PGlite (real migrations),
 * Valkey for a stub plus an in-memory session store, and Keycloak for an OIDC client stub.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  for (const [key, value] of Object.entries({ ...TEST_ENV, ...options.env })) vi.stubEnv(key, value);
  // ConfigModule.forRoot reads the environment when the module is defined, so import after stubbing.
  const { AppModule } = await import('../app.module.js');
  const database = await createTestDatabase();
  const oidc = createOidcStub();
  const valkey: ValkeyStub = {
    isOpen: false,
    isReady: true,
    ping: vi.fn<() => Promise<string>>().mockResolvedValue('PONG'),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    destroy: vi.fn<() => void>(),
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: options.controllers ?? [] })
    .overrideProvider(getDrizzleToken())
    .useValue(database.db)
    .overrideProvider(VALKEY_CLIENT)
    .useValue(valkey)
    .overrideProvider(SESSION_STORE)
    .useValue(new session.MemoryStore())
    .overrideProvider(OIDC_CLIENT)
    .useValue(oidc)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();

  return {
    app,
    http: () => supertest.agent(app.getHttpServer()),
    oidc,
    valkey,
    database,
    close: async () => {
      await app.close();
      await database.close();
      vi.unstubAllEnvs();
    },
  };
}
