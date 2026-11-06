import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';

import type { Env } from '../../config/env.js';
import { describeError } from '../../logging/describe-error.js';
import { INBOX_CHANNEL, InboxSubscribers } from './inbox-signals.js';

/** Reconnect delays: 1, 2, 4… seconds, capped at 30. */
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
/**
 * A connection that dies without a FIN or RST (a node lost in a failover, an idle flow dropped by NAT) never errors on
 * its own, and LISTEN sends nothing to notice it: TCP keepalive and a periodic query turn that into a failure.
 */
const HEALTH_CHECK_MS = 30_000;
const CLIENT_OPTIONS = {
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  query_timeout: 5_000,
} as const;

/**
 * The api role's listener (KTD3): one dedicated client, not from the shared pool, LISTENing on the inbox channel and
 * dispatching each signal to this instance's subscribers for that recipient. When the connection fails it reconnects
 * with backoff and then sends `changed` to every local subscriber, since signals may have been missed meanwhile.
 */
@Injectable()
export class PgInboxSignals extends InboxSubscribers implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PgInboxSignals.name);
  private readonly connectionString: string;
  private client: Client | null = null;
  private retryMs = FIRST_RETRY_MS;
  private retry: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    super();
    this.connectionString = config.get('DATABASE_URL', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    const client = this.client;
    this.client = null;
    await client?.end();
  }

  private async connect(): Promise<void> {
    const client = new Client({ connectionString: this.connectionString, ...CLIENT_OPTIONS });
    let failed = false;
    let health: NodeJS.Timeout | undefined;
    // An error and the end that follows it are one failure.
    const fail = (error: unknown): void => {
      if (failed) return;
      failed = true;
      clearInterval(health);
      this.lost(client, error);
    };
    client.on('notification', ({ channel, payload }) => {
      if (channel === INBOX_CHANNEL && payload) this.dispatch(payload);
    });
    client.on('error', fail);
    client.on('end', () => fail(new Error('The connection ended')));
    try {
      await client.connect();
      await client.query(`LISTEN ${INBOX_CHANNEL}`);
    } catch (error) {
      fail(error);
      return;
    }
    if (failed) return;
    if (this.stopped) {
      await client.end();
      return;
    }
    this.client = client;
    this.retryMs = FIRST_RETRY_MS;
    health = setInterval(() => {
      client.query('SELECT 1').catch(fail);
    }, HEALTH_CHECK_MS);
    // At start nobody has subscribed yet; after a reconnect, signals sent meanwhile may have been missed.
    this.broadcast();
  }

  /** Drops the failed client and schedules the next attempt. */
  private lost(client: Client, error: unknown): void {
    if (this.client === client) this.client = null;
    if (this.stopped) return;
    // The failure is logged below; ending the broken client can only fail the same way.
    client.end().catch(() => undefined);
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    this.logger.warn({
      msg: 'The inbox signal listener lost its connection',
      retryInMs: delay,
      error: describeError(error),
    });
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.connect();
    }, delay);
  }
}
