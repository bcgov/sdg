import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';
import { GuardedHttpClient } from './http-dispatcher.js';
import { OutboundGuard } from './outbound-guard.js';

/**
 * The outbound guard (KTD12), with NOTIFICATION_OUTBOUND_ALLOW_HOSTS as its allow-list, and the guarded HTTP client
 * for webhooks and callbacks. Global: the API checks URLs at registration, workers connect through both.
 */
@Global()
@Module({
  providers: [
    {
      provide: OutboundGuard,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new OutboundGuard({ allowHosts: config.get('NOTIFICATION_OUTBOUND_ALLOW_HOSTS', { infer: true }) }),
    },
    {
      provide: GuardedHttpClient,
      inject: [OutboundGuard],
      useFactory: (guard: OutboundGuard) => new GuardedHttpClient(guard),
    },
  ],
  exports: [OutboundGuard, GuardedHttpClient],
})
export class OutboundModule implements OnApplicationShutdown {
  private readonly http: GuardedHttpClient;

  constructor(@Inject(GuardedHttpClient) http: GuardedHttpClient) {
    this.http = http;
  }

  /** Closes the pooled webhook connections. */
  onApplicationShutdown(): Promise<void> {
    return this.http.close();
  }
}
