import { Injectable } from '@nestjs/common';
import { credentials, senderOwners } from '@repo/notification-database';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { CredentialDirectory, LinkedCredential, PersonRef, SenderOwnership } from '../auth/directories.js';
import { InjectDatabase, type NotificationDatabase } from '../database/database.module.js';
import { scopesByCredential } from './credentials.service.js';

/** The credential directory the guards use (R8): a client id's link, sender and scoped types, read per token. */
@Injectable()
export class DbCredentialDirectory implements CredentialDirectory {
  private readonly db: NotificationDatabase;

  constructor(@InjectDatabase() db: NotificationDatabase) {
    this.db = db;
  }

  async findByClientId(clientId: string): Promise<LinkedCredential | null> {
    const [credential] = await this.db
      .select({ credentialId: credentials.id, senderId: credentials.senderId })
      .from(credentials)
      .where(eq(credentials.clientId, clientId));
    if (!credential) return null;
    const scopes = await scopesByCredential(this.db, [credential.credentialId]);
    return { ...credential, scopedTypes: scopes.get(credential.credentialId) ?? [] };
  }
}

const senderIdSchema = z.uuid();

/** Sender ownership the OwnerGuard checks (R7), from the owners the admin named (R6). */
@Injectable()
export class DbSenderOwnership implements SenderOwnership {
  private readonly db: NotificationDatabase;

  constructor(@InjectDatabase() db: NotificationDatabase) {
    this.db = db;
  }

  async isOwner(senderId: string, person: PersonRef): Promise<boolean> {
    // Guards run before the route's param validation: a malformed id names no sender.
    if (!senderIdSchema.safeParse(senderId).success) return false;
    const [owner] = await this.db
      .select({ senderId: senderOwners.senderId })
      .from(senderOwners)
      .where(
        and(
          eq(senderOwners.senderId, senderId),
          eq(senderOwners.issuer, person.issuer),
          eq(senderOwners.subject, person.subject),
        ),
      )
      .limit(1);
    return owner !== undefined;
  }
}
