import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DrizzleModule, InjectDrizzle } from '@nestjs/drizzle';
import { createDatabase } from '@repo/database';

import type { Env } from '../config/env.js';

export type { Database } from '@repo/database';

/** Injects the shared portal database (the only place a connection pool is created). */
export const InjectDatabase = (): PropertyDecorator & ParameterDecorator => InjectDrizzle();

@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        db: createDatabase(config.get('DATABASE_URL', { infer: true })),
      }),
    }),
  ],
})
export class DatabaseModule {}
