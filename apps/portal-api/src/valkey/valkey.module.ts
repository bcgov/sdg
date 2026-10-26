import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';

import type { Env } from '../config/env.js';

/** Valkey speaks the Redis protocol, so the node-redis client is used as-is. */
export type ValkeyClient = RedisClientType;

export const VALKEY_CLIENT = Symbol('VALKEY_CLIENT');

const logger = new Logger('Valkey');

/**
 * Connects in the background: the app boots while Valkey is down, readiness reports it, and node-redis keeps
 * reconnecting. Commands issued before the connection is up are queued.
 */
export function createValkeyClient(url: string): ValkeyClient {
  const client: ValkeyClient = createClient({ url });
  client.on('error', (error: unknown) => {
    logger.error('Valkey connection error', error instanceof Error ? error.stack : String(error));
  });
  client.connect().catch((error: unknown) => {
    logger.error('Valkey initial connection failed', error instanceof Error ? error.stack : String(error));
  });
  return client;
}

@Injectable()
class ValkeyLifecycle implements OnApplicationShutdown {
  private readonly client: ValkeyClient;

  constructor(@Inject(VALKEY_CLIENT) client: ValkeyClient) {
    this.client = client;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) await this.client.close();
    else this.client.destroy();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: VALKEY_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): ValkeyClient =>
        createValkeyClient(config.get('VALKEY_URL', { infer: true })),
    },
    ValkeyLifecycle,
  ],
  exports: [VALKEY_CLIENT],
})
export class ValkeyModule {}
