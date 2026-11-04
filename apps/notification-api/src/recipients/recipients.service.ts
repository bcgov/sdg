import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '@repo/auth';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { PersonRef } from '../auth/directories.js';
import { SecretCipher } from '../crypto/secret-cipher.js';
import { generateWebhookSecret } from '../crypto/signing.js';
import { InjectDatabase, type DbOrTx, type NotificationDatabase } from '../database/database.module.js';
import { contactPoints, recipientRegistrations, recipients } from '../database/schema/index.js';
import { describeError } from '../logging/describe-error.js';
import { OutboundGuard } from '../outbound/outbound-guard.js';
import { ContactPointsService, signingSecretLocation, type SenderContactPoint } from './contact-points.service.js';
import { normalizeEmail } from './normalize.js';
import type {
  AddressRecipientResponse,
  AddressSettings,
  RegisterSystem,
  SystemRecipientResponse,
} from './recipients.schemas.js';
import { VerificationService } from './verification.service.js';

/** An address-only recipient as a send names it (R27, R39). */
export interface AddressRecipientInput {
  readonly channel: 'email';
  readonly address: string;
  /** The sender's own reference for the person, e.g. a form id (F2). */
  readonly reference?: string | null;
  readonly language?: string | null;
  readonly timeZone?: string | null;
}

/** Only the settings given: an omitted key leaves the stored value as it is. */
function givenSettings(input: AddressRecipientInput) {
  return {
    ...(input.reference === undefined ? {} : { reference: input.reference }),
    ...(input.language === undefined ? {} : { language: input.language }),
    ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
  };
}

/**
 * The recipient registry (R27, R32, R33): users by issuer + subject, each sender's address-only recipients by
 * normalized address, and each sender's systems by system id. Every write is an upsert on that key, so racing writes
 * resolve through the unique index to one recipient.
 */
@Injectable()
export class RecipientsService {
  private readonly logger = new Logger(RecipientsService.name);
  private readonly db: NotificationDatabase;
  private readonly contactPoints: ContactPointsService;
  private readonly verification: VerificationService;
  private readonly cipher: SecretCipher;
  private readonly outbound: OutboundGuard;

  constructor(
    @InjectDatabase() db: NotificationDatabase,
    @Inject(ContactPointsService) points: ContactPointsService,
    @Inject(VerificationService) verification: VerificationService,
    @Inject(SecretCipher) cipher: SecretCipher,
    @Inject(OutboundGuard) outbound: OutboundGuard,
  ) {
    this.db = db;
    this.contactPoints = points;
    this.verification = verification;
    this.cipher = cipher;
    this.outbound = outbound;
  }

  /**
   * The user's recipient id, for every relayed call (R32). The first call creates the recipient, or claims the one a
   * sender pre-registered, and seeds the IdP email once: verified when the token says so, otherwise unverified with a
   * confirmation sent (R35). Seeding is never repeated, so a removed seed stays removed.
   */
  async claimUser(user: AuthUser): Promise<string> {
    const [existing] = await this.db
      .select({ id: recipients.id, claimedAt: recipients.claimedAt })
      .from(recipients)
      .where(this.userKey(user));
    if (existing?.claimedAt) return existing.id;

    const { id, toConfirm } = await this.db.transaction(async (tx) => {
      const recipientId = await this.upsertUser(user, tx);
      // Only the call that moves claimed_at from null seeds; a racing first call waits on the row and finds it set.
      const [claimed] = await tx
        .update(recipients)
        .set({ claimedAt: sql`now()` })
        .where(and(eq(recipients.id, recipientId), isNull(recipients.claimedAt)))
        .returning({ id: recipients.id });
      if (!claimed || !user.email) return { id: recipientId, toConfirm: null };
      const address = normalizeEmail(user.email);
      const pointId = await this.contactPoints.seedIdpEmail(tx, recipientId, address, user.emailVerified);
      return { id: recipientId, toConfirm: pointId && { pointId, address } };
    });
    if (toConfirm) await this.confirmSeedQuietly(id, toConfirm.pointId, toConfirm.address);
    return id;
  }

  /** The user's recipient id, creating the recipient when there is none. Does not claim it. */
  async upsertUser(person: PersonRef, db: DbOrTx = this.db): Promise<string> {
    const [created] = await db
      .insert(recipients)
      .values({ kind: 'user', issuer: person.issuer, subject: person.subject })
      .onConflictDoNothing({ target: [recipients.issuer, recipients.subject] })
      .returning({ id: recipients.id });
    if (created) return created.id;
    // A concurrent insert won: the conflict waited for it to commit, so this statement sees its row.
    const [found] = await db.select({ id: recipients.id }).from(recipients).where(this.userKey(person));
    if (!found) throw new Error('Upserting the user recipient found no row');
    return found.id;
  }

  /**
   * Pre-registers a user for a sender with that sender's contact points (R27, R33). A user who already exists only
   * gains the sender's points. Runs in the caller's transaction when given one (U9's accept).
   */
  async upsertUserForSender(
    senderId: string,
    person: PersonRef,
    points: readonly SenderContactPoint[],
    db: DbOrTx = this.db,
  ): Promise<string> {
    const recipientId = await this.upsertUser(person, db);
    await Promise.all([
      db.insert(recipientRegistrations).values({ senderId, recipientId }).onConflictDoNothing(),
      this.contactPoints.addSenderPoints(recipientId, senderId, points, db),
    ]);
    return recipientId;
  }

  /**
   * The sender's address-only recipient for the address, created when new (R27): one per normalized address
   * (KTD17). Its address is its contact point, owned by the sender. Language, timezone and reference are updated
   * when given (R39).
   */
  async upsertAddressRecipient(senderId: string, input: AddressRecipientInput, db: DbOrTx = this.db): Promise<string> {
    const address = normalizeEmail(input.address);
    const settings = givenSettings(input);
    const [row] = await db
      .insert(recipients)
      .values({ kind: 'address', senderId, channel: input.channel, address, ...settings })
      .onConflictDoUpdate({
        target: [recipients.senderId, recipients.channel, recipients.address],
        set: { ...settings, updatedAt: sql`now()` },
      })
      .returning({ id: recipients.id });
    if (!row) throw new Error('Upserting the address-only recipient returned no row');
    await this.contactPoints.addSenderPoints(row.id, senderId, [{ channel: input.channel, address }], db);
    return row.id;
  }

  /** Sets language and timezone on the sender's address-only recipient, creating it when new (R39). */
  async setAddressSettings(senderId: string, input: AddressSettings): Promise<AddressRecipientResponse> {
    const id = await this.upsertAddressRecipient(senderId, input);
    const [row] = await this.db
      .select({ address: recipients.address, language: recipients.language, timeZone: recipients.timeZone })
      .from(recipients)
      .where(eq(recipients.id, id));
    if (!row?.address) throw new Error('The address-only recipient has no address');
    return { channel: 'email', address: row.address, language: row.language, timeZone: row.timeZone };
  }

  /** The sender's own system recipient, or null: another sender's systems are invisible to it (R33). */
  async findSystem(senderId: string, systemId: string, db: DbOrTx = this.db): Promise<string | null> {
    const [row] = await db
      .select({ id: recipients.id })
      .from(recipients)
      .where(and(eq(recipients.senderId, senderId), eq(recipients.systemId, systemId)));
    return row?.id ?? null;
  }

  /**
   * Registers a system with webhook endpoints (R33). Each new endpoint gets its own signing secret, returned only
   * here and stored sealed (KTD10); an endpoint registered before keeps its secret.
   */
  async registerSystem(senderId: string, input: RegisterSystem): Promise<SystemRecipientResponse> {
    const problem = input.webhookUrls.map((url) => this.outbound.urlProblem(url)).find((found) => found !== null);
    if (problem) throw new BadRequestException(problem);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(recipients)
        .values({ kind: 'system', senderId, systemId: input.systemId })
        .onConflictDoUpdate({ target: [recipients.senderId, recipients.systemId], set: { updatedAt: sql`now()` } })
        .returning({ id: recipients.id });
      if (!row) throw new Error('Upserting the system recipient returned no row');
      const secrets = new Map<string, string>();
      const endpoints = [...new Set(input.webhookUrls)].map((url) => {
        const id = randomUUID();
        const secret = generateWebhookSecret();
        secrets.set(id, secret);
        const sealed = this.cipher.encrypt(secret, signingSecretLocation(id));
        const verifiedAt = new Date();
        return {
          id,
          recipientId: row.id,
          channel: 'webhook' as const,
          address: url,
          signingSecret: sealed,
          ownerSenderId: senderId,
          source: 'sender' as const,
          verifiedAt,
        };
      });
      await tx.insert(contactPoints).values(endpoints).onConflictDoNothing();
      const webhooks = await tx
        .select({ id: contactPoints.id, url: contactPoints.address })
        .from(contactPoints)
        .where(and(eq(contactPoints.recipientId, row.id), eq(contactPoints.channel, 'webhook')))
        .orderBy(asc(contactPoints.createdAt), asc(contactPoints.address));
      return {
        systemId: input.systemId,
        webhooks: webhooks.map(({ id, url }) => ({ id, url, secret: secrets.get(id) ?? null })),
      };
    });
  }

  /** A failed or refused seed confirmation must not fail the user's call: it is logged, and they can resend it. */
  private async confirmSeedQuietly(recipientId: string, pointId: string, address: string): Promise<void> {
    if (!this.verification.available) {
      this.logger.warn({ msg: 'Seeded an unverified IdP email with no platform email integration to confirm it' });
      return;
    }
    try {
      await this.contactPoints.confirmSeed(recipientId, pointId, address);
    } catch (error) {
      this.logger.warn({ msg: 'Could not send the seeded IdP email its confirmation', error: describeError(error) });
    }
  }

  private userKey(person: PersonRef) {
    return and(eq(recipients.issuer, person.issuer), eq(recipients.subject, person.subject));
  }
}
