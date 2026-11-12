import 'reflect-metadata';
import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createOidcClient, type OidcClient } from '@repo/auth';
import { OIDC_CLIENT } from '@repo/auth/nestjs';
import { CLIENT_ID, CLIENT_SECRET, startFakeIdp, type FakeIdp } from '@repo/auth/testing';
import { configureApp, type ConfigureAppOptions } from '@repo/server-core/nestjs';
import supertest from 'supertest';

import { BFF_APP_OPTIONS, SESSION_DATABASE } from '../../nestjs/bff.options.js';
import type { SessionDatabase } from '../../session/session-database.js';
import { startCoreApiStub, type CoreApiStub } from '../core-api-stub.js';

/**
 * The env a BFF validates at boot, minus KEYCLOAK_ISSUER_URL and CORE_API_URL (the stubs' URLs, set per app). A type
 * alias, not an interface, so it is assignable to `Record<string, string>`.
 */
export type BffTestEnv = {
  readonly NODE_ENV: 'test';
  readonly LOG_LEVEL: 'silent';
  readonly APP_URL: string;
  readonly DATABASE_URL: string;
  readonly SESSION_SECRET: string;
  readonly KEYCLOAK_CLIENT_ID: string;
  readonly KEYCLOAK_CLIENT_SECRET: string;
};

/** The test env for the BFF at `appUrl` whose Postgres login is `login`. The database URL is never connected to. */
export function bffTestEnv(appUrl: string, login: string): BffTestEnv {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    APP_URL: appUrl,
    DATABASE_URL: `postgres://${login}@127.0.0.1:1/portal`,
    SESSION_SECRET: 'test-session-secret-at-least-32-characters',
    KEYCLOAK_CLIENT_ID: CLIENT_ID,
    KEYCLOAK_CLIENT_SECRET: CLIENT_SECRET,
  };
}

/** An in-process sessions database (PGlite with the real sessions migrations), created by the app's own helper. */
export interface BffTestDatabase {
  db: SessionDatabase;
  close: () => Promise<void>;
}

/** What one BFF app supplies: its URL and boot env, how to load its AppModule, and its sessions database. */
export interface BffTestAppConfig<D extends BffTestDatabase> {
  appUrl: string;
  /** The env the app validates at boot (usually `bffTestEnv`). */
  env: Readonly<Record<string, string>>;
  /** Imports the app's AppModule. Called after the env is set, since ConfigModule.forRoot reads it on import. */
  loadAppModule: () => Promise<Type>;
  createDatabase: () => Promise<D>;
  swagger: ConfigureAppOptions['swagger'];
}

export interface BffTestAppOptions {
  /** Extra controllers mounted on the real AppModule (e.g. a probe for the global validation pipe). */
  controllers?: Type[];
  /** Env overrides on top of the app's test env. */
  env?: Record<string, string>;
}

export interface BffTestApp<D extends BffTestDatabase = BffTestDatabase> {
  app: NestExpressApplication;
  /** A cookie-keeping client whose requests carry the app's own Origin, as the web app's same-origin fetches do. */
  http: () => supertest.Agent;
  /** The in-process Keycloak stand-in (`@repo/auth/testing`). */
  idp: FakeIdp;
  /** The OIDC client the app uses, for spying (e.g. on `createAuthorizationRequest`). */
  oidc: OidcClient;
  /** The core-api stand-in: records every request and answers like core-api by default. */
  coreApi: CoreApiStub;
  database: D;
  close: () => Promise<void>;
}

/** Sets `env` on `process.env` and returns a function that puts the previous values back. */
function setEnv(env: Readonly<Record<string, string>>): () => void {
  const previous = Object.keys(env).map((key) => [key, process.env[key]] as const);
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

/**
 * The app's real AppModule and HTTP conventions (configureApp, BFF_APP_OPTIONS as in its main.ts), with Postgres
 * swapped for the app's PGlite database, Keycloak for the fake IdP and core-api for a loopback stub.
 */
export async function createBffTestApp<D extends BffTestDatabase>(
  config: BffTestAppConfig<D>,
  options: BffTestAppOptions = {},
): Promise<BffTestApp<D>> {
  const [idp, coreApi, database] = await Promise.all([startFakeIdp(), startCoreApiStub(), config.createDatabase()]);
  const restoreEnv = setEnv({
    ...config.env,
    KEYCLOAK_ISSUER_URL: idp.issuer,
    CORE_API_URL: coreApi.url,
    ...options.env,
  });
  const AppModule = await config.loadAppModule();
  const oidc = createOidcClient({
    issuerUrl: idp.issuer,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: `${config.appUrl}/api/auth/callback`,
    postLogoutRedirectUri: `${config.appUrl}/`,
    fetch: idp.fetch,
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: options.controllers ?? [] })
    .overrideProvider(SESSION_DATABASE)
    .useValue(database.db)
    .overrideProvider(OIDC_CLIENT)
    .useValue(oidc)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false, ...BFF_APP_OPTIONS });
  configureApp(app, { swagger: config.swagger });
  await app.init();

  return {
    app,
    http: () => supertest.agent(app.getHttpServer()).set('origin', config.appUrl),
    idp,
    oidc,
    coreApi,
    database,
    close: async () => {
      await app.close();
      await Promise.all([idp.close(), coreApi.close(), database.close()]);
      restoreEnv();
    },
  };
}

/** The claims the fake IdP puts in the ID token at sign-in. */
export interface IdTokenClaims {
  readonly sub: string;
  readonly name: string;
  readonly email: string;
}

/** Starts a login on `agent` and returns the callback query the fake IdP would send the browser back with. */
export async function authorizeBff(
  t: BffTestApp,
  agent: supertest.Agent,
  claims: IdTokenClaims,
  returnTo = '/',
): Promise<Record<string, string>> {
  const login = await agent.get('/api/auth/login').query({ returnTo });
  const location = new URL(login.headers['location'] ?? '');
  const code = t.idp.issueCode({
    nonce: location.searchParams.get('nonce') ?? '',
    codeChallenge: location.searchParams.get('code_challenge') ?? '',
    claims: { ...claims },
  });
  return { code, state: location.searchParams.get('state') ?? '' };
}

export interface SignedIn {
  /** Holds the session cookie. */
  agent: supertest.Agent;
  /** The callback response. */
  res: supertest.Response;
}

/** Signs in through the fake IdP and the core-api stub; throws unless the `cookieName` session cookie was set. */
export async function signInBff(
  t: BffTestApp,
  identity: { readonly cookieName: string; readonly claims: IdTokenClaims },
  returnTo = '/',
): Promise<SignedIn> {
  const agent = t.http();
  const callback = await authorizeBff(t, agent, identity.claims, returnTo);
  const res = await agent.get('/api/auth/callback').query(callback);
  if (res.status !== 302 || !res.headers['set-cookie']?.[0]?.startsWith(`${identity.cookieName}=s%3A`)) {
    throw new Error(`sign-in failed: ${res.status} ${res.headers['location'] ?? ''}`);
  }
  return { agent, res };
}

/** One BFF app's test harness: `createBffTestApp`, `authorizeBff` and `signInBff` bound to its settings. */
export interface BffTestKit<D extends BffTestDatabase> {
  createTestApp: (options?: BffTestAppOptions) => Promise<BffTestApp<D>>;
  authorize: (t: BffTestApp<D>, agent: supertest.Agent, returnTo?: string) => Promise<Record<string, string>>;
  signIn: (t: BffTestApp<D>, returnTo?: string) => Promise<SignedIn>;
}

/** Binds the harness to one app: its config plus the session cookie and the user it signs in as. */
export function bffTestKit<D extends BffTestDatabase>(
  config: BffTestAppConfig<D> & { readonly cookieName: string; readonly claims: IdTokenClaims },
): BffTestKit<D> {
  return {
    createTestApp: (options) => createBffTestApp(config, options),
    authorize: (t, agent, returnTo) => authorizeBff(t, agent, config.claims, returnTo),
    signIn: (t, returnTo) => signInBff(t, config, returnTo),
  };
}
