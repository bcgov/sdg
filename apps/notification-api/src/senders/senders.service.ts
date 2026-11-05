import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';

import { TypesService } from '../catalog/types.service.js';
import { SecretCipher } from '../crypto/secret-cipher.js';
import { generateWebhookSecret } from '../crypto/signing.js';
import { InjectDatabase, type NotificationDatabase } from '../database/database.module.js';
import { senderOwners, senders, senderTypeGrants } from '../database/schema/index.js';
import { OutboundGuard } from '../outbound/outbound-guard.js';
import { requireSender } from './require-sender.js';
import type { CallbackResponse, Owner, SenderResponse } from './senders.schemas.js';

/** Where a sender's callback secret is sealed: the AAD binds it to this row and field (KTD11). */
export const callbackSecretLocation = (senderId: string) => ({ rowId: senderId, field: 'callbackSecret' });

/** Senders, their owners and type grants (R6), and the failure callback (R7). */
@Injectable()
export class SendersService {
  private readonly db: NotificationDatabase;
  private readonly cipher: SecretCipher;
  private readonly outbound: OutboundGuard;
  private readonly types: TypesService;

  constructor(
    @InjectDatabase() db: NotificationDatabase,
    @Inject(SecretCipher) cipher: SecretCipher,
    @Inject(OutboundGuard) outbound: OutboundGuard,
    @Inject(TypesService) types: TypesService,
  ) {
    this.db = db;
    this.cipher = cipher;
    this.outbound = outbound;
    this.types = types;
  }

  async create(name: string): Promise<SenderResponse> {
    const [created] = await this.db.insert(senders).values({ name }).returning({ id: senders.id });
    if (!created) throw new Error('Inserting the sender returned no row');
    return this.get(created.id);
  }

  /** The sender, without its callback secret. 404 when there is none. */
  async get(senderId: string): Promise<SenderResponse> {
    const [[sender], owners, grants] = await Promise.all([
      this.db
        .select({ id: senders.id, name: senders.name, callbackUrl: senders.callbackUrl })
        .from(senders)
        .where(eq(senders.id, senderId)),
      this.db
        .select({ issuer: senderOwners.issuer, subject: senderOwners.subject })
        .from(senderOwners)
        .where(eq(senderOwners.senderId, senderId))
        .orderBy(asc(senderOwners.createdAt), asc(senderOwners.issuer), asc(senderOwners.subject)),
      this.db
        .select({ typeKey: senderTypeGrants.typeKey })
        .from(senderTypeGrants)
        .where(eq(senderTypeGrants.senderId, senderId))
        .orderBy(asc(senderTypeGrants.typeKey)),
    ]);
    if (!sender) throw new NotFoundException();
    return { ...sender, owners, grantedTypes: grants.map((grant) => grant.typeKey) };
  }

  async addOwner(senderId: string, owner: Owner): Promise<SenderResponse> {
    await requireSender(this.db, senderId);
    await this.db
      .insert(senderOwners)
      .values({ senderId, ...owner })
      .onConflictDoNothing();
    return this.get(senderId);
  }

  async removeOwner(senderId: string, owner: Owner): Promise<SenderResponse> {
    await requireSender(this.db, senderId);
    await this.db
      .delete(senderOwners)
      .where(
        and(
          eq(senderOwners.senderId, senderId),
          eq(senderOwners.issuer, owner.issuer),
          eq(senderOwners.subject, owner.subject),
        ),
      );
    return this.get(senderId);
  }

  /** Grants a Notification type, which must exist in the catalog (R6, R13). */
  async grant(senderId: string, typeKey: string): Promise<SenderResponse> {
    await Promise.all([requireSender(this.db, senderId), this.requireType(typeKey)]);
    await this.db.insert(senderTypeGrants).values({ senderId, typeKey }).onConflictDoNothing();
    return this.get(senderId);
  }

  /**
   * Revokes a type from the sender and from every credential's scope (R9). The scopes reference the grant with
   * ON DELETE CASCADE, so the one DELETE removes both atomically.
   */
  async revoke(senderId: string, typeKey: string): Promise<SenderResponse> {
    await requireSender(this.db, senderId);
    await this.db
      .delete(senderTypeGrants)
      .where(and(eq(senderTypeGrants.senderId, senderId), eq(senderTypeGrants.typeKey, typeKey)));
    return this.get(senderId);
  }

  /**
   * Sets the failure callback URL with a new signing secret, returned only here and stored sealed (KTD10). The URL
   * must be https unless its host is on the outbound allow-list (R51).
   */
  async setCallback(senderId: string, url: string): Promise<CallbackResponse> {
    const problem = this.outbound.urlProblem(url);
    if (problem) throw new BadRequestException(problem);
    const secret = generateWebhookSecret();
    const sealed = this.cipher.encrypt(secret, callbackSecretLocation(senderId));
    const [updated] = await this.db
      .update(senders)
      .set({ callbackUrl: url, callbackSecret: sealed })
      .where(eq(senders.id, senderId))
      .returning({ id: senders.id });
    if (!updated) throw new NotFoundException();
    return { url, secret };
  }

  private async requireType(typeKey: string): Promise<void> {
    if (!(await this.types.find(typeKey))) throw new NotFoundException('No Notification type with this key');
  }
}
