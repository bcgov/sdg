import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DrizzleModule, InjectDrizzle } from '@nestjs/drizzle';
import { createPortalDatabase } from '@repo/portal-database';

import type { Env } from '../config/env.js';

export type { PortalDatabase } from '@repo/portal-database';

/** Injects the shared portal database (the only place a connection pool is created). */
export const InjectDatabase = (): PropertyDecorator & ParameterDecorator => InjectDrizzle();

@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        db: createPortalDatabase(config.get('DATABASE_URL', { infer: true })),
      }),
    }),
  ],
})
export class DatabaseModule {}
