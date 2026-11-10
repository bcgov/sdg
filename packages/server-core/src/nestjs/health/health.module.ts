import { Module, type DynamicModule, type InjectionToken, type OptionalFactoryDependency } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller.js';
import { READINESS_CHECKS, type ReadinessChecks } from './readiness.js';

export interface HealthModuleAsyncOptions {
  imports?: DynamicModule['imports'];
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  /** The dependencies GET /healthz/ready checks, by name (e.g. `{ database, keycloak }`). */
  useFactory: (...args: never[]) => ReadinessChecks | Promise<ReadinessChecks>;
}

/** GET /healthz/live and /healthz/ready, outside the /api prefix (configureApp). */
@Module({})
export class HealthModule {
  static forRootAsync(options: HealthModuleAsyncOptions): DynamicModule {
    return {
      module: HealthModule,
      imports: [TerminusModule.forRoot({ errorLogStyle: 'pretty' }), ...(options.imports ?? [])],
      controllers: [HealthController],
      providers: [{ provide: READINESS_CHECKS, inject: options.inject ?? [], useFactory: options.useFactory }],
    };
  }
}
