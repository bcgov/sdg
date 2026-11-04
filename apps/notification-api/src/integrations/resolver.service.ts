import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import type { Channel } from '../channels/channels.js';
import { SecretCipher } from '../crypto/secret-cipher.js';
import { InjectDatabase, type NotificationDatabase } from '../database/database.module.js';
import { senderIntegrations } from '../database/schema/index.js';
import { PLATFORM_INTEGRATIONS, type PlatformIntegrations, type ResolvedIntegration } from './platform-defaults.js';
import { parseIntegrationConfig } from './registry.js';
import { openSecretFields } from './secret-fields.js';

/**
 * Picks the integration for one delivery attempt (KTD9): the sender's override for the channel, else the platform
 * default, else none. Read on every attempt, so a changed or deleted override applies to the next one.
 */
@Injectable()
export class IntegrationResolver {
  private readonly db: NotificationDatabase;
  private readonly cipher: SecretCipher;
  private readonly defaults: PlatformIntegrations;

  constructor(
    @InjectDatabase() db: NotificationDatabase,
    @Inject(SecretCipher) cipher: SecretCipher,
    @Inject(PLATFORM_INTEGRATIONS) defaults: PlatformIntegrations,
  ) {
    this.db = db;
    this.cipher = cipher;
    this.defaults = defaults;
  }

  /** The integration with its secrets opened, or null when the channel has no usable integration for the sender. */
  async resolve(senderId: string, channel: Channel): Promise<ResolvedIntegration | null> {
    const [override] = await this.db
      .select()
      .from(senderIntegrations)
      .where(and(eq(senderIntegrations.senderId, senderId), eq(senderIntegrations.channel, channel)));
    if (!override) return this.defaults[channel] ?? null;
    const opened = openSecretFields(this.cipher, override.type, override.id, override.config);
    return {
      ...parseIntegrationConfig(override.type, opened),
      id: override.id,
      version: String(override.version),
      source: 'sender',
      channel,
    };
  }
}
