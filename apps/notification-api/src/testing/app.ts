import 'reflect-metadata';
import type { DynamicModule, Type } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { vi, type Mock } from 'vitest';

import { AppModule } from '../app.module.js';
import { configureApp } from '../bootstrap.js';
import { HTTP_FETCH, type HttpFetch } from '../health/indicators.js';
import { createTestDatabase, type TestDatabase } from './database.js';

export const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://notification:notification@localhost:5432/notification_test',
  KEYCLOAK_ISSUER_URL: 'https://keycloak.example.com/realms/standard',
  NOTIFICATION_CLIENT_ID: 'notification-api',
  RELAYING_CLIENT_IDS: 'portal',
  NOTIFICATION_ENCRYPTION_KEY: 'test-encryption-key-at-least-32-characters',
} as const;

export const ISSUER_DISCOVERY_URL = `${TEST_ENV.KEYCLOAK_ISSUER_URL}/.well-known/openid-configuration`;
export const ISSUER_JWKS_URL = `${TEST_ENV.KEYCLOAK_ISSUER_URL}/protocol/openid-connect/certs`;

/** The URL a fetch call was made with. */
export function requestUrl(input: Parameters<HttpFetch>[0]): string {
  if (input instanceof Request) return input.url;
  return input instanceof URL ? input.href : input;
}

/** Stands in for the issuer: serves its discovery document and a one-key JWKS, 404 for anything else. */
export function createIssuerFetch(): Mock<HttpFetch> {
  return vi.fn<HttpFetch>((input) => {
    const url = requestUrl(input);
    if (url === ISSUER_DISCOVERY_URL) {
      return Promise.resolve(Response.json({ issuer: TEST_ENV.KEYCLOAK_ISSUER_URL, jwks_uri: ISSUER_JWKS_URL }));
    }
    if (url === ISSUER_JWKS_URL) {
      return Promise.resolve(Response.json({ keys: [{ kty: 'RSA', kid: 'test-key', use: 'sig' }] }));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  });
}

export interface TestApp {
  app: NestExpressApplication;
  http: () => supertest.Agent;
  issuerFetch: Mock<HttpFetch>;
  /** This test file's PGlite database, which the app uses in place of Postgres. */
  database: TestDatabase;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  /** Extra controllers mounted on the root module (e.g. probes for the guards). */
  controllers?: Type[];
  /** Env overrides on top of TEST_ENV. */
  env?: Record<string, string>;
  /** Serves the issuer for the readiness check and token verification; defaults to `createIssuerFetch()`. */
  issuerFetch?: HttpFetch;
  /** Builds the root module once the env is stubbed; defaults to the real AppModule. */
  module?: () => DynamicModule;
}

/**
 * The real AppModule and HTTP conventions, with Postgres swapped for a fresh PGlite (real migrations) and the
 * issuer's endpoints served by a fetch stub (or by `src/testing/tokens.ts`'s fake issuer, which signs tokens).
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  for (const [key, value] of Object.entries({ ...TEST_ENV, ...options.env })) vi.stubEnv(key, value);
  const issuerFetch = options.issuerFetch ? vi.fn<HttpFetch>(options.issuerFetch) : createIssuerFetch();
  const database = await createTestDatabase();

  // Registering the root module reads the environment, so it happens after stubbing.
  const root = options.module ?? (() => AppModule.register());
  const moduleRef = await Test.createTestingModule({ imports: [root()], controllers: options.controllers ?? [] })
    .overrideProvider(getDrizzleToken())
    .useValue(database.db)
    .overrideProvider(HTTP_FETCH)
    .useValue(issuerFetch)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();

  return {
    app,
    http: () => supertest.agent(app.getHttpServer()),
    issuerFetch,
    database,
    close: async () => {
      await app.close();
      await database.close();
      vi.unstubAllEnvs();
    },
  };
}
