import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { senderIntegrations, senders, type Channel } from '@repo/notification-database';
import { and, eq, sql } from 'drizzle-orm';

import { SecretCipher } from '../crypto/secret-cipher.js';
import { InjectDatabase, type NotificationDatabase } from '../database/database.module.js';
import type { IntegrationResponse, PutIntegration } from './integrations.schemas.js';
import { integrationType } from './registry.js';
import { maskSecretFields, sealSecretFields } from './secret-fields.js';

type IntegrationRow = typeof senderIntegrations.$inferSelect;

function toResponse(row: IntegrationRow): IntegrationResponse {
  const { config, secretFieldsSet } = maskSecretFields(row.type, row.config);
  return { id: row.id, channel: row.channel, type: row.type, version: row.version, config, secretFieldsSet };
}

/** A sender's integration overrides (R47), one per channel, with secret fields sealed at rest (R48). */
@Injectable()
export class IntegrationsService {
  private readonly db: NotificationDatabase;
  private readonly cipher: SecretCipher;

  constructor(@InjectDatabase() db: NotificationDatabase, @Inject(SecretCipher) cipher: SecretCipher) {
    this.db = db;
    this.cipher = cipher;
  }

  /** Creates or replaces the override. Its secrets are sealed for its row id, which a replace keeps. */
  async put(senderId: string, channel: Channel, { type, config }: PutIntegration): Promise<IntegrationResponse> {
    if (integrationType(type)?.channel !== channel) {
      throw new BadRequestException(`The ${type} integration type does not deliver the ${channel} channel`);
    }
    const row = await this.db.transaction(async (tx) => {
      // Locks the sender, so concurrent first writes for one channel don't seal for two different row ids.
      const [sender] = await tx.select({ id: senders.id }).from(senders).where(eq(senders.id, senderId)).for('update');
      if (!sender) throw new NotFoundException();
      const [existing] = await tx
        .select({ id: senderIntegrations.id })
        .from(senderIntegrations)
        .where(and(eq(senderIntegrations.senderId, senderId), eq(senderIntegrations.channel, channel)));
      const id = existing?.id ?? randomUUID();
      const sealed = sealSecretFields(this.cipher, type, id, config);
      const [saved] = existing
        ? await tx
            .update(senderIntegrations)
            .set({ type, config: sealed, version: sql`${senderIntegrations.version} + 1` })
            .where(eq(senderIntegrations.id, id))
            .returning()
        : await tx.insert(senderIntegrations).values({ id, senderId, channel, type, config: sealed }).returning();
      if (!saved) throw new Error('Saving the integration returned no row');
      return saved;
    });
    return toResponse(row);
  }

  /** The override without its secrets. 404 when the sender has none for the channel. */
  async get(senderId: string, channel: Channel): Promise<IntegrationResponse> {
    const [row] = await this.db
      .select()
      .from(senderIntegrations)
      .where(and(eq(senderIntegrations.senderId, senderId), eq(senderIntegrations.channel, channel)));
    if (!row) throw new NotFoundException();
    return toResponse(row);
  }

  /** Removes the override; the channel falls back to the platform default. 404 when there is none. */
  async remove(senderId: string, channel: Channel): Promise<void> {
    const deleted = await this.db
      .delete(senderIntegrations)
      .where(and(eq(senderIntegrations.senderId, senderId), eq(senderIntegrations.channel, channel)))
      .returning({ id: senderIntegrations.id });
    if (deleted.length === 0) throw new NotFoundException();
  }
}
