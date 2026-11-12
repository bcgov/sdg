import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DrizzleModule, InjectDrizzle } from '@nestjs/drizzle';
import { createDatabase, type Database } from '@repo/database';
import { describeError } from '@repo/server-core';

import type { Env } from '../config/env.js';

export type { Database } from '@repo/database';

/** Injects the database as the `core` login (the only place a connection pool is created). */
export const InjectDatabase = (): PropertyDecorator & ParameterDecorator => InjectDrizzle();

/** core-api's pool, which logs a dropped idle client (pg has already discarded it) instead of crashing. */
export function createCoreDatabase(databaseUrl: string): Database {
  const logger = new Logger('Database');
  return createDatabase(databaseUrl, {
    onIdleClientError: (error) => logger.error({ msg: 'Idle Postgres client error', error: describeError(error) }),
  });
}

@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        db: createCoreDatabase(config.get('DATABASE_URL', { infer: true })),
      }),
    }),
  ],
})
export class DatabaseModule {}
