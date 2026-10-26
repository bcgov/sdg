import { Inject, Module, RequestMethod, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisStore } from 'connect-redis';
import type { Request } from 'express';
import session, { type Store } from 'express-session';

import type { Env } from '../config/env.js';
import { VALKEY_CLIENT, type ValkeyClient } from '../valkey/valkey.module.js';
import './session.types.js';

export const SESSION_COOKIE = 'portal.sid';
export const SESSION_PREFIX = 'portal:sess:';
/** The express-session store; tests override it with an in-memory store. */
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
      inject: [VALKEY_CLIENT, ConfigService],
      useFactory: (client: ValkeyClient, config: ConfigService<Env, true>): Store =>
        new RedisStore({ client, prefix: SESSION_PREFIX, ttl: config.get('SESSION_TTL_SECONDS', { infer: true }) }),
    },
  ],
})
export class SessionModule implements NestModule {
  private readonly config: ConfigService<Env, true>;
  private readonly store: Store;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>, @Inject(SESSION_STORE) store: Store) {
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
    // Only /api/* routes get a session; the /healthz probes are outside the prefix and never touch Valkey.
    consumer.apply(middleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
