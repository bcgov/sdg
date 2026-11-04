import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DrizzleModule, InjectDrizzle } from '@nestjs/drizzle';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { Env } from '../config/env.js';
import * as schema from './schema/index.js';

export type NotificationSchema = typeof schema;

export type NotificationDatabase = NodePgDatabase<NotificationSchema> & { $client: Pool };

/** Injects the notification database. */
export const InjectDatabase = (): PropertyDecorator & ParameterDecorator => InjectDrizzle();

/**
 * The app's one connection pool, on the `notification` database (KTD2). DrizzleModule is global, closes the pool on
 * shutdown and logs pool errors. Tests replace the database with PGlite (src/testing/app.ts).
 */
@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const pool = new Pool({ connectionString: config.get('DATABASE_URL', { infer: true }) });
        return { db: drizzle({ client: pool, schema, casing: 'snake_case' }) };
      },
    }),
  ],
})
export class DatabaseModule {}
