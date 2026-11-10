import 'reflect-metadata';
import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createOidcClient, type OidcClient } from '@repo/auth';
import { OIDC_CLIENT } from '@repo/auth/nestjs';
import { CLIENT_ID, CLIENT_SECRET, startFakeIdp, type FakeIdp } from '@repo/auth/testing';
import { BFF_APP_OPTIONS, SESSION_DATABASE } from '@repo/bff-core/nestjs';
import { startCoreApiStub, type CoreApiStub } from '@repo/bff-core/testing';
import { configureApp } from '@repo/server-core/nestjs';
import supertest from 'supertest';
import { vi } from 'vitest';

import { swaggerOptions } from '../openapi/swagger-options.js';
import { createTestDatabase, type TestDatabase } from './database.js';

export const APP_URL = 'http://localhost:5174';

/** The env admin-api validates at boot; KEYCLOAK_ISSUER_URL and CORE_API_URL come from the stubs started per app. */
export const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  APP_URL,
  DATABASE_URL: 'postgres://admin@127.0.0.1:1/portal',
  SESSION_SECRET: 'test-session-secret-at-least-32-characters',
  KEYCLOAK_CLIENT_ID: CLIENT_ID,
  KEYCLOAK_CLIENT_SECRET: CLIENT_SECRET,
} as const;

export interface TestApp {
  app: NestExpressApplication;
  /** A cookie-keeping client whose requests carry the app's own Origin, as admin-web's same-origin fetches do. */
  http: () => supertest.Agent;
  idp: FakeIdp;
  /** The OIDC client the app uses, for spying (e.g. on `createAuthorizationRequest`). */
  oidc: OidcClient;
  /** The core-api stand-in: records every request and answers like core-api by default. */
  coreApi: CoreApiStub;
  database: TestDatabase;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  /** Extra controllers mounted on the real AppModule (e.g. a probe for the global validation pipe). */
  controllers?: Type[];
  /** Env overrides on top of TEST_ENV. */
  env?: Record<string, string>;
}

function oidcClientFor(idp: FakeIdp): OidcClient {
  return createOidcClient({
    issuerUrl: idp.issuer,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: `${APP_URL}/api/auth/callback`,
    postLogoutRedirectUri: `${APP_URL}/`,
    fetch: idp.fetch,
  });
}

/**
 * The real AppModule and HTTP conventions (configureApp, BFF_APP_OPTIONS as in main.ts), with Postgres swapped for PGlite
 * (the real sessions migrations), Keycloak for the fake IdP and core-api for a loopback stub.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const [idp, coreApi, database] = await Promise.all([startFakeIdp(), startCoreApiStub(), createTestDatabase()]);
  const env = { ...TEST_ENV, KEYCLOAK_ISSUER_URL: idp.issuer, CORE_API_URL: coreApi.url, ...options.env };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  // ConfigModule.forRoot reads the environment when the module is defined, so import after stubbing.
  const { AppModule } = await import('../app.module.js');
  const oidc = oidcClientFor(idp);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: options.controllers ?? [] })
    .overrideProvider(SESSION_DATABASE)
    .useValue(database.db)
    .overrideProvider(OIDC_CLIENT)
    .useValue(oidc)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false, ...BFF_APP_OPTIONS });
  configureApp(app, { swagger: swaggerOptions });
  await app.init();

  return {
    app,
    http: () => supertest.agent(app.getHttpServer()).set('origin', APP_URL),
    idp,
    oidc,
    coreApi,
    database,
    close: async () => {
      await app.close();
      await Promise.all([idp.close(), coreApi.close(), database.close()]);
      vi.unstubAllEnvs();
    },
  };
}

/** The claims the fake IdP puts in the ID token at sign-in; core-api's userinfo profile differs on purpose. */
export const ID_TOKEN_CLAIMS = { sub: 'idir-admin-1', name: 'Grace Hopper', email: 'grace@example.gov.bc.ca' } as const;

/** Starts a login on `agent` and returns the callback query the fake IdP would send the browser back with. */
export async function authorize(t: TestApp, agent: supertest.Agent, returnTo = '/'): Promise<Record<string, string>> {
  const login = await agent.get('/api/auth/login').query({ returnTo });
  const location = new URL(login.headers['location'] ?? '');
  const code = t.idp.issueCode({
    nonce: location.searchParams.get('nonce') ?? '',
    codeChallenge: location.searchParams.get('code_challenge') ?? '',
    claims: ID_TOKEN_CLAIMS,
  });
  return { code, state: location.searchParams.get('state') ?? '' };
}

export interface SignedIn {
  agent: supertest.Agent;
  res: supertest.Response;
}

/** Signs in through the fake IdP and the core-api stub; throws unless a session cookie was set. */
export async function signIn(t: TestApp, returnTo = '/'): Promise<SignedIn> {
  const agent = t.http();
  const callback = await authorize(t, agent, returnTo);
  const res = await agent.get('/api/auth/callback').query(callback);
  if (res.status !== 302 || !res.headers['set-cookie']?.[0]?.startsWith('admin.sid=s%3A')) {
    throw new Error(`sign-in failed: ${res.status} ${res.headers['location'] ?? ''}`);
  }
  return { agent, res };
}
