import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { configureApp } from '@repo/server-core/nestjs';
import supertest from 'supertest';
import { vi } from 'vitest';

import { swaggerOptions } from '../openapi/swagger-options.js';
import { startCoreApiStub, type CoreApiStub } from './core-api-stub.js';

export interface TestApp {
  app: NestExpressApplication;
  http: () => supertest.Agent;
  /** The core-api stand-in: records every request and answers like core-api's gateway route by default. */
  coreApi: CoreApiStub;
  close: () => Promise<void>;
}

/** The real AppModule and HTTP conventions (configureApp, as in main.ts), with core-api swapped for a loopback stub. */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const coreApi = await startCoreApiStub();
  const stubbed = { NODE_ENV: 'test', LOG_LEVEL: 'silent', CORE_API_URL: coreApi.url, ...env };
  for (const [key, value] of Object.entries(stubbed)) vi.stubEnv(key, value);
  // ConfigModule.forRoot reads the environment when the module is defined, so import after stubbing.
  const { AppModule } = await import('../app.module.js');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, { swagger: swaggerOptions });
  await app.init();

  return {
    app,
    http: () => supertest.agent(app.getHttpServer()),
    coreApi,
    close: async () => {
      await app.close();
      await coreApi.close();
      vi.unstubAllEnvs();
    },
  };
}
