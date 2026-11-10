import 'reflect-metadata';
import { Controller, Get, Module, VERSION_NEUTRAL } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createEnvValidator, serviceEnvShape } from '../../env.js';
import { HealthModule } from '../health/health.module.js';
import { LoggingModule } from '../logging/logging.module.js';
import { configureApp } from './configure-app.js';

const validateEnv = createEnvValidator(z.object(serviceEnvShape('core-api')));

@Controller({ path: 'things', version: '1' })
class ThingsController {
  @Get()
  list(): string[] {
    return ['a'];
  }
}

/** A route outside the /api prefix (`unprefixed`), like core-api's /internal/*. */
@Controller({ path: 'internal/things', version: VERSION_NEUTRAL })
class InternalThingsController {
  @Get('first')
  first(): string {
    return 'internal';
  }
}

interface Probe {
  app: NestExpressApplication;
  http: () => supertest.Agent;
  database: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

/** A service with one versioned controller and one readiness check, configured like every service's main.ts. */
async function createProbe(nodeEnv: 'development' | 'production'): Promise<Probe> {
  const database = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  @Module({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validate: (raw) => validateEnv({ ...raw, NODE_ENV: nodeEnv, LOG_LEVEL: 'silent' }),
      }),
      LoggingModule,
      HealthModule.forRootAsync({ useFactory: () => ({ database: () => database() }) }),
    ],
    controllers: [ThingsController, InternalThingsController],
  })
  class ProbeModule {}

  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, {
    swagger: {
      title: 'Core API',
      description: 'Business rules',
      version: '1.2.3',
      configure: (builder) => builder.addBearerAuth(),
    },
    unprefixed: ['internal/{*path}'],
  });
  await app.init();
  return { app, http: () => supertest.agent(app.getHttpServer()), database };
}

describe('configureApp (development)', () => {
  let probe: Probe;

  beforeAll(async () => {
    probe = await createProbe('development');
  });

  afterAll(() => probe.app.close());

  beforeEach(() => {
    probe.database.mockReset().mockResolvedValue(undefined);
  });

  it('serves versioned routes under /api with helmet headers and no x-powered-by', async () => {
    const res = await probe.http().get('/api/v1/things');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['a']);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect((await probe.http().get('/v1/things')).status).toBe(404);
  });

  it('serves the unprefixed routes outside /api only', async () => {
    const res = await probe.http().get('/internal/things/first');
    expect(res.status).toBe(200);
    expect(res.text).toBe('internal');
    expect((await probe.http().get('/api/internal/things/first')).status).toBe(404);
  });

  it('serves /metrics outside /api', async () => {
    expect((await probe.http().get('/metrics')).status).toBe(200);
    expect((await probe.http().get('/api/metrics')).status).toBe(404);
  });

  it('answers /healthz/live without touching dependencies', async () => {
    const res = await probe.http().get('/healthz/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', info: {}, error: {}, details: {} });
    expect(probe.database).not.toHaveBeenCalled();
  });

  it('runs every injected readiness check on /healthz/ready', async () => {
    const res = await probe.http().get('/healthz/ready');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.info)).toEqual(['database']);
    expect(res.body.info.database.status).toBe('up');
    expect(probe.database).toHaveBeenCalledTimes(1);
  });

  it('answers 503 with the failing check marked down', async () => {
    probe.database.mockRejectedValue(new Error('unreachable'));
    const res = await probe.http().get('/healthz/ready');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ database: { status: 'down' } });
  });

  it('serves the OpenAPI document with the given title, version and security schemes', async () => {
    const res = await probe.http().get('/api/docs-json');
    expect(res.status).toBe(200);
    expect(res.body.info).toMatchObject({ title: 'Core API', description: 'Business rules', version: '1.2.3' });
    expect(res.body.components.securitySchemes).toHaveProperty('bearer');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/api/v1/things', '/healthz/live', '/healthz/ready']),
    );
  });
});

describe('configureApp (production)', () => {
  let probe: Probe;

  beforeAll(async () => {
    probe = await createProbe('production');
  });

  afterAll(() => probe.app.close());

  it('serves no Swagger UI or OpenAPI document', async () => {
    expect((await probe.http().get('/api/docs')).status).toBe(404);
    expect((await probe.http().get('/api/docs-json')).status).toBe(404);
    expect((await probe.http().get('/api/v1/things')).status).toBe(200);
  });
});
