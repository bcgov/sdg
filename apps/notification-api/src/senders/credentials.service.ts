import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { TOKEN_CLIENTS } from '../auth/principal.resolver.js';
import type { TokenClients } from '../auth/token-kind.js';
import { InjectDatabase, type NotificationDatabase } from '../database/database.module.js';
import { credentials, credentialTypeScopes, senders, senderTypeGrants } from '../database/schema/index.js';
import type { CredentialResponse } from './senders.schemas.js';

type Reader = Pick<NotificationDatabase, 'select'>;

/** Each credential's scoped type keys, sorted. */
export async function scopesByCredential(db: Reader, credentialIds: readonly string[]): Promise<Map<string, string[]>> {
  const scopes = new Map<string, string[]>(credentialIds.map((id) => [id, []]));
  if (credentialIds.length === 0) return scopes;
  const rows = await db
    .select({ credentialId: credentialTypeScopes.credentialId, typeKey: credentialTypeScopes.typeKey })
    .from(credentialTypeScopes)
    .where(inArray(credentialTypeScopes.credentialId, [...credentialIds]))
    .orderBy(asc(credentialTypeScopes.typeKey));
  for (const row of rows) scopes.get(row.credentialId)?.push(row.typeKey);
  return scopes;
}

const credentialColumns = { id: credentials.id, clientId: credentials.clientId };

/**
 * A sender's credentials and their scopes (R8). Every lookup is by the path's sender id as well as the credential id,
 * so another sender's credential is a 404.
 */
@Injectable()
export class CredentialsService {
  private readonly db: NotificationDatabase;
  private readonly clients: TokenClients;

  constructor(@InjectDatabase() db: NotificationDatabase, @Inject(TOKEN_CLIENTS) clients: TokenClients) {
    this.db = db;
    this.clients = clients;
  }

  /** Links a client id. notification-api's own client and relaying clients can never be credentials (R8). */
  async link(senderId: string, clientId: string): Promise<CredentialResponse> {
    if (clientId === this.clients.ownClientId || this.clients.relayingClientIds.includes(clientId)) {
      throw new BadRequestException('This client cannot be linked as a credential');
    }
    await this.requireSender(senderId);
    const [created] = await this.db
      .insert(credentials)
      .values({ senderId, clientId })
      .onConflictDoNothing({ target: credentials.clientId })
      .returning(credentialColumns);
    if (!created) throw new ConflictException('This client is already linked as a credential');
    return { ...created, scopedTypes: [] };
  }

  async list(senderId: string): Promise<CredentialResponse[]> {
    await this.requireSender(senderId);
    const rows = await this.db
      .select(credentialColumns)
      .from(credentials)
      .where(eq(credentials.senderId, senderId))
      .orderBy(asc(credentials.createdAt), asc(credentials.clientId));
    const scopes = await scopesByCredential(
      this.db,
      rows.map((row) => row.id),
    );
    return rows.map(({ id, clientId }) => ({ id, clientId, scopedTypes: scopes.get(id) ?? [] }));
  }

  async get(senderId: string, credentialId: string): Promise<CredentialResponse> {
    const credential = await this.find(this.db, senderId, credentialId);
    const scopes = await scopesByCredential(this.db, [credential.id]);
    return { ...credential, scopedTypes: scopes.get(credential.id) ?? [] };
  }

  /** Replaces the credential's scope. Every type must be granted to the sender (R8); otherwise nothing changes. */
  async setScopes(senderId: string, credentialId: string, typeKeys: readonly string[]): Promise<CredentialResponse> {
    const wanted = [...new Set(typeKeys)].toSorted();
    await this.db.transaction(async (tx) => {
      const [credential, grants] = await Promise.all([
        this.find(tx, senderId, credentialId),
        tx
          .select({ typeKey: senderTypeGrants.typeKey })
          .from(senderTypeGrants)
          .where(eq(senderTypeGrants.senderId, senderId))
          // A concurrent revoke waits for this transaction, so a checked grant still exists at the insert.
          .for('share'),
      ]);
      const granted = new Set(grants.map((grant) => grant.typeKey));
      const ungranted = wanted.filter((typeKey) => !granted.has(typeKey));
      if (ungranted.length > 0) {
        throw new BadRequestException(`Not granted to this sender: ${ungranted.join(', ')}`);
      }
      await tx.delete(credentialTypeScopes).where(eq(credentialTypeScopes.credentialId, credential.id));
      if (wanted.length === 0) return;
      await tx
        .insert(credentialTypeScopes)
        .values(wanted.map((typeKey) => ({ credentialId: credential.id, senderId, typeKey })));
    });
    return this.get(senderId, credentialId);
  }

  async unlink(senderId: string, credentialId: string): Promise<void> {
    const [deleted] = await this.db
      .delete(credentials)
      .where(and(eq(credentials.id, credentialId), eq(credentials.senderId, senderId)))
      .returning({ id: credentials.id });
    if (!deleted) throw new NotFoundException();
  }

  private async find(db: Reader, senderId: string, credentialId: string): Promise<{ id: string; clientId: string }> {
    const [credential] = await db
      .select(credentialColumns)
      .from(credentials)
      .where(and(eq(credentials.id, credentialId), eq(credentials.senderId, senderId)));
    if (!credential) throw new NotFoundException();
    return credential;
  }

  private async requireSender(senderId: string): Promise<void> {
    const [sender] = await this.db.select({ id: senders.id }).from(senders).where(eq(senders.id, senderId));
    if (!sender) throw new NotFoundException();
  }
}
