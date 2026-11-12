import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createOidcClient, type OidcClient, type OidcTokens } from '@repo/auth';
import { OIDC_CLIENT } from '@repo/auth/nestjs';
import { CLIENT_ID, CLIENT_SECRET, type FakeIdp } from '@repo/auth/testing';
import { configureApp } from '@repo/server-core/nestjs';
import type { SessionData } from 'express-session';
import supertest from 'supertest';

import { BffModule } from '../nestjs/bff.module.js';
import { BFF_APP_OPTIONS, SESSION_DATABASE, SESSION_STORE, type BffModuleOptions } from '../nestjs/bff.options.js';
import type { PostgresSessionStore } from '../session/postgres-session.store.js';
import type { CoreApiStub } from '../testing/core-api-stub.js';
import type { TestSessionDatabase } from './database.js';

/** express-session hands its callbacks `any`; reject with an Error either way. */
const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

export const APP_URL = 'http://app.test';
export const SECRET = 'test-session-secret-at-least-32-characters';

export interface BffTestApp {
  app: NestExpressApplication;
  /** A cookie-keeping client whose requests carry the app's own Origin, as portal-web's fetch calls do. */
  http: () => supertest.Agent;
  oidc: OidcClient;
  store: PostgresSessionStore;
  options: BffModuleOptions;
  close: () => Promise<void>;
}

export interface BffTestAppOptions {
  idp: FakeIdp;
  coreApi: CoreApiStub;
  database: TestSessionDatabase;
  overrides?: Partial<BffModuleOptions>;
}

function moduleOptions({ idp, coreApi, overrides }: BffTestAppOptions): BffModuleOptions {
  return {
    appUrl: APP_URL,
    databaseUrl: 'postgres://portal@127.0.0.1:1/portal',
    session: { cookieName: 'portal.sid', secret: SECRET, keyInfo: 'portal-session-store', ttlSeconds: 3600 },
    oidc: { issuerUrl: idp.issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, fetch: idp.fetch },
    coreApiUrl: coreApi.url,
    audiences: ['portal'],
    ...overrides,
  };
}

/** A BFF app on BffModule as a service would wire it: configureApp, BFF_APP_OPTIONS, PGlite sessions, the fake IdP. */
export async function createBffTestApp(setup: BffTestAppOptions): Promise<BffTestApp> {
  const options = moduleOptions(setup);
  @Module({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ NODE_ENV: 'test', TRUST_PROXY: false })] }),
      BffModule.forRootAsync({ useFactory: () => options }),
    ],
  })
  class TestAppModule {}

  const oidc = createOidcClient({
    ...options.oidc,
    redirectUri: `${APP_URL}/api/auth/callback`,
    postLogoutRedirectUri: `${APP_URL}/`,
  });
  const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] })
    .overrideProvider(SESSION_DATABASE)
    .useValue(setup.database.db)
    .overrideProvider(OIDC_CLIENT)
    .useValue(oidc)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false, ...BFF_APP_OPTIONS });
  configureApp(app, { swagger: { title: 'BFF test', description: 'bff-core tests', version: '0.0.0' } });
  await app.init();
  return {
    app,
    http: () => supertest.agent(app.getHttpServer()).set('origin', APP_URL),
    oidc,
    store: app.get(SESSION_STORE),
    options,
    close: () => app.close(),
  };
}

/** The session id in a `<cookie>=s:<sid>.<signature>` Set-Cookie header. */
export function sessionIdFrom(res: supertest.Response): string | undefined {
  const cookie = res.headers['set-cookie']?.[0];
  const value = cookie === undefined ? undefined : decodeURIComponent(cookie.split(';')[0]?.split('=')[1] ?? '');
  return value?.match(/^s:([^.]+)\./)?.[1];
}

export interface SignedIn {
  /** Holds the session cookie. */
  agent: supertest.Agent;
  sid: string;
  /** The `portal.sid=…` pair, for presenting the session from another client. */
  cookie: string;
  res: supertest.Response;
}

/** Signs in through the fake IdP and core-api. */
export async function signIn(t: BffTestApp, idp: FakeIdp, agent: supertest.Agent = t.http()): Promise<SignedIn> {
  const login = await agent.get('/api/auth/login').query({ returnTo: '/after' });
  const location = new URL(login.headers['location'] ?? '');
  const code = idp.issueCode({
    nonce: location.searchParams.get('nonce') ?? '',
    codeChallenge: location.searchParams.get('code_challenge') ?? '',
    claims: { sub: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const res = await agent.get('/api/auth/callback').query({ code, state: location.searchParams.get('state') ?? '' });
  const sid = sessionIdFrom(res);
  const cookie = res.headers['set-cookie']?.[0]?.split(';')[0];
  if (res.status !== 302 || sid === undefined || cookie === undefined) {
    throw new Error(`sign-in failed: ${res.status} ${res.text}`);
  }
  return { agent, sid, cookie, res };
}

/** Rewrites the stored session's tokens, as if Keycloak had issued these at sign-in. */
export async function setTokens(t: BffTestApp, sid: string, tokens: Partial<OidcTokens>): Promise<OidcTokens> {
  const data = await t.store.readSession(sid);
  if (!data?.auth) throw new Error(`no signed-in session ${sid}`);
  data.auth.tokens = { ...data.auth.tokens, ...tokens };
  const session: SessionData = {
    ...data,
    cookie: { originalMaxAge: 3_600_000, expires: new Date(Date.now() + 3_600_000), httpOnly: true, path: '/' },
  };
  await new Promise<void>((resolve, reject) =>
    t.store.set(sid, session, (error: unknown) => (error ? reject(asError(error)) : resolve())),
  );
  return data.auth.tokens;
}

/** The response's Set-Cookie headers. */
export function setCookies(res: supertest.Response): string[] {
  const value: unknown = res.headers['set-cookie'];
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((cookie): cookie is string => typeof cookie === 'string') : [];
}
