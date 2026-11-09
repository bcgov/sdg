import {
  type BeforeApplicationShutdown,
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type ModuleMetadata,
  type OnApplicationBootstrap,
  type Type,
} from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { z } from 'zod';

/**
 * KTD4: one app, three roles, chosen by NOTIFICATION_ROLE. `api` serves the API routes; `worker` runs the worker loops
 * and serves only /healthz/* and /metrics; `all` (the default, and what the local stack runs) does both.
 */
export const ROLES = ['api', 'worker', 'all'] as const;
export type Role = (typeof ROLES)[number];

export const roleSchema = z.enum(ROLES).default('all');

export function servesApi(role: Role): boolean {
  return role !== 'worker';
}

export function runsWorkers(role: Role): boolean {
  return role !== 'api';
}

/** The role from a raw environment, blank or unset meaning `all`. envSchema has already rejected unknown roles. */
export function roleFromEnv(env: Readonly<Record<string, string | undefined>>): Role {
  const raw = env.NOTIFICATION_ROLE?.trim();
  return roleSchema.parse(raw === '' ? undefined : raw);
}

/** A background loop run by the worker role (expansion, delivery). */
export interface WorkerLoop {
  /** Starts the loop without waiting for it: called once the app has bootstrapped. */
  start(): void;
  /** Stops claiming new work and resolves once in-flight work has finished. */
  drain(): Promise<void>;
}

/** The worker role's loops, in start order. */
export const WORKER_LOOPS = Symbol('WORKER_LOOPS');

/**
 * Starts every loop in onApplicationBootstrap and drains them in beforeApplicationShutdown, which Nest runs before
 * onApplicationShutdown, so loops finish while the database pool is still open (KTD4).
 */
@Injectable()
export class WorkerRunner implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly loops: readonly WorkerLoop[];

  constructor(@Inject(WORKER_LOOPS) loops: readonly WorkerLoop[]) {
    this.loops = loops;
  }

  onApplicationBootstrap(): void {
    for (const loop of this.loops) loop.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    await Promise.all(this.loops.map((loop) => loop.drain()));
  }
}

export interface WorkerRoleOptions {
  /** Modules the loops depend on (database, delivery services). */
  readonly imports?: ModuleMetadata['imports'];
  readonly loops: readonly Type<WorkerLoop>[];
}

@Module({})
export class WorkerRoleModule {
  static register({ imports = [], loops }: WorkerRoleOptions): DynamicModule {
    return {
      module: WorkerRoleModule,
      imports,
      providers: [
        ...loops,
        { provide: WORKER_LOOPS, useFactory: (...instances: WorkerLoop[]) => instances, inject: [...loops] },
        WorkerRunner,
      ],
    };
  }
}

export interface RoleOptions {
  /** Feature modules with API controllers: imported only when the role serves the API. */
  readonly api: NonNullable<ModuleMetadata['imports']>;
  readonly worker: WorkerRoleOptions;
}

@Module({})
export class ApiRoleModule {
  static register(imports: NonNullable<ModuleMetadata['imports']>): DynamicModule {
    return { module: ApiRoleModule, imports };
  }
}

/**
 * Imports the API modules and the worker loops according to NOTIFICATION_ROLE. The role is read once @nestjs/config
 * has loaded the environment (including any .env file), so it applies however the app is started.
 */
@Module({})
export class RoleModule {
  static register({ api, worker }: RoleOptions): DynamicModule {
    const options = { debug: false };
    return {
      module: RoleModule,
      imports: [
        ConditionalModule.registerWhen(ApiRoleModule.register(api), (env) => servesApi(roleFromEnv(env)), options),
        ConditionalModule.registerWhen(
          WorkerRoleModule.register(worker),
          (env) => runsWorkers(roleFromEnv(env)),
          options,
        ),
      ],
    };
  }
}
