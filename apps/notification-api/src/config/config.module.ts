import { type DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './env.js';

/**
 * Global, validated configuration. Inject `ConfigService<Env, true>` and read keys with `get(key, { infer: true })`.
 * Registered per app instance (AppModule.register), so the environment is read when the app is created.
 */
@Module({})
export class AppConfigModule {
  static register(): DynamicModule {
    return {
      module: AppConfigModule,
      imports: [ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv })],
    };
  }
}
