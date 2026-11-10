import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './env.js';

/** Global, validated configuration. Inject `ConfigService<Env, true>` and read keys with `get(key, { infer: true })`. */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv })],
})
export class AppConfigModule {}
