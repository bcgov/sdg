import {
  Inject,
  Logger,
  Module,
  RequestMethod,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createOidcClient, type OidcClient } from '@repo/auth';
import type { AsyncModuleOptions } from '@repo/auth/nestjs';
import { OIDC_CLIENT } from '@repo/auth/nestjs';
import { describeError } from '@repo/server-core';
import session from 'express-session';
import { Pool } from 'pg';

import { AuthController } from '../auth/auth.controller.js';
import { createCoreApiLogin, type LoginHook } from '../auth/core-api-login.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { BffForwardController } from '../forward/bff-forward.controller.js';
import { OriginGuard } from '../origin/origin.guard.js';
import { TokenRefreshService } from '../refresh/token-refresh.service.js';
import { PostgresSessionStore } from '../session/postgres-session.store.js';
import { deriveSessionKey } from '../session/session-cipher.js';
import { createSessionDatabase, type SessionDatabase } from '../session/session-database.js';
import {
  BFF_OPTIONS,
  LOGIN_HOOK,
  SESSION_DATABASE,
  SESSION_POOL,
  SESSION_STORE,
  type BffModuleOptions,
} from './bff.options.js';

export type BffModuleAsyncOptions = AsyncModuleOptions<BffModuleOptions>;

/**
 * The sessions pool. pg connects lazily, on the first query. When Postgres drops an idle client (a restart, a Patroni
 * switchover) the pool discards it and emits 'error', which would crash the process without a listener.
 */
function createSessionPool(options: BffModuleOptions): Pool {
  const pool = new Pool({ connectionString: options.databaseUrl });
  const logger = new Logger('SessionPool');
  pool.on('error', (error) => logger.error({ msg: 'Idle Postgres client error', error: describeError(error) }));
  return pool;
}

const sessionProviders = [
  { provide: SESSION_POOL, inject: [BFF_OPTIONS], useFactory: createSessionPool },
  { provide: SESSION_DATABASE, inject: [SESSION_POOL], useFactory: createSessionDatabase },
  {
    provide: SESSION_STORE,
    inject: [SESSION_DATABASE, BFF_OPTIONS],
    useFactory: (db: SessionDatabase, options: BffModuleOptions): PostgresSessionStore =>
      new PostgresSessionStore(db, {
        key: deriveSessionKey(options.session.secret, options.session.keyInfo),
        ttlSeconds: options.session.ttlSeconds,
        logger: new Logger('SessionStore'),
      }),
  },
];

const authProviders = [
  {
    provide: OIDC_CLIENT,
    inject: [BFF_OPTIONS],
    useFactory: (options: BffModuleOptions): OidcClient =>
      createOidcClient({
        ...options.oidc,
        redirectUri: `${options.appUrl}/api/auth/callback`,
        postLogoutRedirectUri: `${options.appUrl}/`,
      }),
  },
  {
    provide: LOGIN_HOOK,
    inject: [BFF_OPTIONS],
    useFactory: (options: BffModuleOptions): LoginHook =>
      options.onLogin ?? createCoreApiLogin({ coreApiUrl: options.coreApiUrl }),
  },
  SessionAuthGuard,
  TokenRefreshService,
  { provide: APP_GUARD, useClass: OriginGuard },
];

/**
 * A browser BFF's sessions, OIDC login (`/api/auth/*`), token refresh, origin check and forwarding to core-api
 * (`/api/v<N>/<audience>/…`), configured per BFF. Import it once, in the app module, which also needs
 * server-core's LoggingModule and `configureApp`. The app must be created
 * with `BFF_APP_OPTIONS` (`rawBody: true`) so JSON and form bodies are forwarded byte for byte.
 */
@Module({})
export class BffModule implements NestModule, OnApplicationShutdown {
  private readonly options: BffModuleOptions;
  private readonly store: PostgresSessionStore;
  private readonly pool: Pool;

  constructor(
    @Inject(BFF_OPTIONS) options: BffModuleOptions,
    @Inject(SESSION_STORE) store: PostgresSessionStore,
    @Inject(SESSION_POOL) pool: Pool,
  ) {
    this.options = options;
    this.store = store;
    this.pool = pool;
  }

  static forRootAsync(options: BffModuleAsyncOptions): DynamicModule {
    return {
      module: BffModule,
      // Global, so the app's other modules (e.g. a readiness check on SESSION_DATABASE) can inject its exports.
      global: true,
      imports: options.imports ?? [],
      // The forwarder's catch-all goes last, after the routes it must not shadow.
      controllers: [AuthController, BffForwardController],
      providers: [
        { provide: BFF_OPTIONS, inject: options.inject ?? [], useFactory: options.useFactory },
        ...sessionProviders,
        ...authProviders,
      ],
      exports: [BFF_OPTIONS, OIDC_CLIENT, SESSION_DATABASE, SESSION_STORE, SessionAuthGuard, TokenRefreshService],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    const { cookieName, secret, ttlSeconds } = this.options.session;
    const middleware = session({
      name: cookieName,
      secret,
      store: this.store,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.options.appUrl.startsWith('https:'),
        maxAge: ttlSeconds * 1000,
        path: '/',
      },
    });
    // Only /api/* routes get a session; the /healthz probes are outside the prefix and never touch the session store.
    consumer.apply(middleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
