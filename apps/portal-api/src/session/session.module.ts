import { Inject, Module, RequestMethod, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { getDrizzleToken } from '@nestjs/drizzle';
import type { OidcClient } from '@repo/auth';
import { OIDC_CLIENT } from '@repo/auth/nestjs';
import type { Request } from 'express';
import session from 'express-session';

import type { Env } from '../config/env.js';
import type { PortalDatabase } from '../database/database.module.js';
import { activityMiddleware } from './activity.middleware.js';
import { PostgresSessionStore } from './postgres-session.store.js';
import { deriveSessionKey } from './session-cipher.js';
import './session.types.js';

export const SESSION_COOKIE = 'portal.sid';
/** The express-session store (a `PostgresSessionStore`). */
export const SESSION_STORE = Symbol('SESSION_STORE');

/** Promisified `req.session` operations, so handlers can await them and errors propagate. */
export function sessionOp(req: Request, op: 'save' | 'regenerate' | 'destroy'): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session[op]((error: unknown) => {
      if (!error) resolve();
      else reject(error instanceof Error ? error : new Error(`Session ${op} failed`, { cause: error }));
    });
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
  private readonly moduleRef: ModuleRef;

  constructor(
    @Inject(ConfigService) config: ConfigService<Env, true>,
    @Inject(SESSION_STORE) store: PostgresSessionStore,
    @Inject(ModuleRef) moduleRef: ModuleRef,
  ) {
    this.config = config;
    this.store = store;
    this.moduleRef = moduleRef;
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
    // AuthModule provides the OIDC client; importing it here would close an import cycle through AuthController.
    const oidc = this.moduleRef.get<OidcClient>(OIDC_CLIENT, { strict: false });
    // Only /api/* routes get a session; the /healthz probes are outside the prefix and never touch the session store.
    consumer
      .apply(middleware, activityMiddleware({ oidc, ttlSeconds, store: this.store }))
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
