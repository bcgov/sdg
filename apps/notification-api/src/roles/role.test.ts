import { Controller, Get, Injectable, Module, type DynamicModule } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { OtelHandle } from '../telemetry/otel-sdk.js';
import type { TestApp } from '../testing/app.js';
import type { Role, WorkerLoop } from './role.js';

/** What the probe loop saw, in order: shared by every instance so it survives app teardown. */
const loopEvents: string[] = [];

@Injectable()
class ProbeLoop implements WorkerLoop {
  start(): void {
    loopEvents.push('start');
  }

  async drain(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
    loopEvents.push('drained');
  }
}

@Controller({ path: 'probe', version: '1' })
class ProbeController {
  @Get()
  get(): { ok: true } {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeApiModule {}

async function statusOf(t: TestApp, path: string): Promise<number> {
  return (await t.http().get(path)).status;
}

// The SDK starts before Nest and Express are first imported, as the --import preload does in production, so /metrics
// has a bound exporter; the role modules and the test app are imported afterwards.
describe('NOTIFICATION_ROLE', () => {
  let otel: OtelHandle;
  let modules: {
    createTestApp: typeof import('../testing/app.js').createTestApp;
    AppConfigModule: typeof import('../config/config.module.js').AppConfigModule;
    DatabaseModule: typeof import('../database/database.module.js').DatabaseModule;
    HealthModule: typeof import('../health/health.module.js').HealthModule;
    RoleModule: typeof import('./role.js').RoleModule;
  };

  // The whole app loads here behind OpenTelemetry's import hooks: about 4s alone, past the 10s default when turbo runs
  // every package's tests at once.
  const IMPORT_TIMEOUT_MS = 30_000;

  beforeAll(async () => {
    otel = await (await import('../telemetry/bootstrap.js')).bootstrapTelemetry({});
    const [testing, config, database, health, role] = await Promise.all([
      import('../testing/app.js'),
      import('../config/config.module.js'),
      import('../database/database.module.js'),
      import('../health/health.module.js'),
      import('./role.js'),
    ]);
    modules = {
      createTestApp: testing.createTestApp,
      AppConfigModule: config.AppConfigModule,
      DatabaseModule: database.DatabaseModule,
      HealthModule: health.HealthModule,
      RoleModule: role.RoleModule,
    };
  }, IMPORT_TIMEOUT_MS);

  afterAll(() => otel.shutdown());

  beforeEach(() => {
    loopEvents.length = 0;
  });

  /** The app's own modules with one probe API route and one probe worker loop registered through RoleModule. */
  function withProbes(): DynamicModule {
    const { AppConfigModule, DatabaseModule, HealthModule, RoleModule } = modules;
    @Module({
      imports: [
        AppConfigModule.register(),
        DatabaseModule,
        HealthModule,
        RoleModule.register({ api: [ProbeApiModule], worker: { loops: [ProbeLoop] } }),
      ],
    })
    class ProbeAppModule {}
    return { module: ProbeAppModule };
  }

  async function startAs(role: Role): Promise<TestApp> {
    return modules.createTestApp({ env: { NOTIFICATION_ROLE: role }, module: withProbes });
  }

  it('api serves the API routes and registers no worker loop', async () => {
    const t = await startAs('api');
    expect(await statusOf(t, '/api/v1/probe')).toBe(200);
    expect(await statusOf(t, '/healthz/live')).toBe(200);
    expect(await statusOf(t, '/metrics')).toBe(200);
    await t.close();
    expect(loopEvents).toEqual([]);
  });

  it('worker serves health and metrics but no API routes, runs the loops and drains them on shutdown', async () => {
    const t = await startAs('worker');
    expect(loopEvents).toEqual(['start']);
    expect(await statusOf(t, '/api/v1/probe')).toBe(404);
    expect(await statusOf(t, '/api/docs-json')).toBe(404);
    expect(await statusOf(t, '/healthz/live')).toBe(200);
    expect(await statusOf(t, '/healthz/ready')).toBe(200);
    const metrics = await t.http().get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.text).toContain('target_info');
    await t.close();
    expect(loopEvents).toEqual(['start', 'drained']);
  });

  it('all serves the API routes and runs the loops', async () => {
    const t = await startAs('all');
    expect(loopEvents).toEqual(['start']);
    expect(await statusOf(t, '/api/v1/probe')).toBe(200);
    expect(await statusOf(t, '/healthz/live')).toBe(200);
    await t.close();
    expect(loopEvents).toEqual(['start', 'drained']);
  });

  it('defaults to all when NOTIFICATION_ROLE is blank', async () => {
    const t = await modules.createTestApp({ env: { NOTIFICATION_ROLE: '' }, module: withProbes });
    expect(await statusOf(t, '/api/v1/probe')).toBe(200);
    expect(loopEvents).toEqual(['start']);
    await t.close();
  });

  it('serves Swagger from the real AppModule in the api role but not in the worker role', async () => {
    const api = await modules.createTestApp({ env: { NOTIFICATION_ROLE: 'api' } });
    expect(await statusOf(api, '/api/docs-json')).toBe(200);
    await api.close();
    const worker = await modules.createTestApp({ env: { NOTIFICATION_ROLE: 'worker' } });
    expect(await statusOf(worker, '/api/docs-json')).toBe(404);
    expect(await statusOf(worker, '/healthz/live')).toBe(200);
    await worker.close();
  });
});
