import { Inject, Module, RequestMethod, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getDrizzleToken } from '@nestjs/drizzle';
import type { Request } from 'express';
import session from 'express-session';

import type { Env } from '../config/env.js';
import type { PortalDatabase } from '../database/database.module.js';
import { PostgresSessionStore } from './postgres-session.store.js';
import { deriveSessionKey } from './session-cipher.js';
import './session.types.js';

export const SESSION_COOKIE = 'portal.sid';
/** The express-session store (a `PostgresSessionStore`). */
export const SESSION_STORE = Symbol('SESSION_STORE');

/** Promisified `req.session` operations, so handlers can await them and errors propagate. */
export function sessionOp(req: Request, op: 'save' | 'regenerate' | 'destroy'): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session[op]((error: unknown) =>
      error ? reject(error instanceof Error ? error : new Error(`Session ${op} failed`, { cause: error })) : resolve(),
    );
  });
}

@Module({
  providers: [
    {
      provide: SESSION_STORE,
      inject: [getDrizzleToken(), ConfigService],
      useFactory: (db: PortalDatabase, config: ConfigService<Env, true>): PostgresSessionStore =>
        new PostgresSessionStore(db, {
          key: deriveSessionKey(config.get('SESSION_SECRET', { infer: true })),
          ttlSeconds: config.get('SESSION_TTL_SECONDS', { infer: true }),
        }),
    },
  ],
})
export class SessionModule implements NestModule {
  private readonly config: ConfigService<Env, true>;
  private readonly store: PostgresSessionStore;

  constructor(
    @Inject(ConfigService) config: ConfigService<Env, true>,
    @Inject(SESSION_STORE) store: PostgresSessionStore,
  ) {
    this.config = config;
    this.store = store;
  }

  configure(consumer: MiddlewareConsumer): void {
    const ttlSeconds = this.config.get('SESSION_TTL_SECONDS', { infer: true });
    const middleware = session({
      name: SESSION_COOKIE,
      secret: this.config.get('SESSION_SECRET', { infer: true }),
      store: this.store,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.config.get('APP_URL', { infer: true }).startsWith('https:'),
        maxAge: ttlSeconds * 1000,
        path: '/',
      },
    });
    // Only /api/* routes get a session; the /healthz probes are outside the prefix and never touch the session store.
    consumer.apply(middleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
