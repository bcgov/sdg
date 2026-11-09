import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { contactPoints, verificationTokens, type Channel } from '@repo/notification-database';
import { and, asc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';

import { SecretCipher } from '../crypto/secret-cipher.js';
import {
  InjectDatabase,
  type DbOrTx,
  type NotificationDatabase,
  type NotificationTransaction,
} from '../database/database.module.js';
import type { ContactPointResponse } from './recipients.schemas.js';
import { VerificationService, type PendingConfirmation } from './verification.service.js';

/** Where a webhook endpoint's signing secret is sealed: the AAD binds it to this row and field (KTD11). */
export const signingSecretLocation = (contactPointId: string) => ({ rowId: contactPointId, field: 'signingSecret' });

const ownColumns = {
  id: contactPoints.id,
  address: contactPoints.address,
  source: contactPoints.source,
  verifiedAt: contactPoints.verifiedAt,
};

interface OwnRow {
  id: string;
  address: string;
  source: string;
  verifiedAt: Date | null;
}

function toOwn(row: OwnRow): ContactPointResponse {
  return {
    id: row.id,
    channel: 'email',
    address: row.address,
    verified: row.verifiedAt !== null,
    source: row.source === 'idp' ? 'idp' : 'user',
  };
}

/** A contact point a delivery for one sender may use (R34). */
export interface UsableContactPoint {
  readonly id: string;
  readonly address: string;
  /** Null for the user's own point. */
  readonly ownerSenderId: string | null;
  /** Webhook: the opened signing secret (KTD10). */
  readonly signingSecret: string | null;
}

export interface UsableContactPoints {
  readonly points: UsableContactPoint[];
  /** The recipient has a user-owned point on the channel that is still waiting for confirmation. */
  readonly pendingVerification: boolean;
}

/**
 * The recipient's points on `channel` a delivery from `senderId` may consider (R34): the user's own and the ones that
 * sender supplied. Another sender's points are never included (R33).
 */
export function visibleToSender(recipientId: string, channel: Channel, senderId: string): SQL | undefined {
  return and(
    eq(contactPoints.recipientId, recipientId),
    sql`${contactPoints.channel} = ${channel}`,
    or(isNull(contactPoints.ownerSenderId), eq(contactPoints.ownerSenderId, senderId)),
  );
}

/** One address a sender supplies for a recipient (R33). */
export interface SenderContactPoint {
  readonly channel: Exclude<Channel, 'in-app'>;
  readonly address: string;
}

/**
 * Contact points (R33–R36): the user's own, which need confirmation when the user adds or edits them, and the ones a
 * sender supplied, which are trusted as given but used only for that sender's deliveries and never shown to the user.
 */
@Injectable()
export class ContactPointsService {
  private readonly db: NotificationDatabase;
  private readonly verification: VerificationService;
  private readonly cipher: SecretCipher;

  constructor(
    @InjectDatabase() db: NotificationDatabase,
    @Inject(VerificationService) verification: VerificationService,
    @Inject(SecretCipher) cipher: SecretCipher,
  ) {
    this.db = db;
    this.verification = verification;
    this.cipher = cipher;
  }

  /** The user's own contact points, never the ones senders supplied (R33). */
  async listOwn(recipientId: string): Promise<ContactPointResponse[]> {
    const rows = await this.db
      .select(ownColumns)
      .from(contactPoints)
      .where(and(eq(contactPoints.recipientId, recipientId), isNull(contactPoints.ownerSenderId)))
      .orderBy(asc(contactPoints.createdAt), asc(contactPoints.address));
    return rows.map(toOwn);
  }

  /** Adds an unverified email address and sends its confirmation (R35, R36); 409 when the user already has it. */
  async addOwn(recipientId: string, address: string): Promise<ContactPointResponse> {
    this.verification.requireAvailable();
    const { point, pending } = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(contactPoints)
        .values({ recipientId, channel: 'email', address, ownerSenderId: null, source: 'user' })
        .onConflictDoNothing()
        .returning(ownColumns);
      if (!created) throw new ConflictException('You already have this email address');
      return { point: created, pending: await this.verification.issue(tx, recipientId, created.id, address) };
    });
    await this.verification.send(pending);
    return toOwn(point);
  }

  /** Changes the address, which is then unusable until the new one is confirmed (R35). Earlier links stop working. */
  async editOwn(recipientId: string, contactPointId: string, address: string): Promise<ContactPointResponse> {
    this.verification.requireAvailable();
    const result = await this.db.transaction(async (tx) => {
      const current = await this.lockOwn(tx, recipientId, contactPointId);
      if (current.address === address) return { point: current, pending: null };
      const [taken] = await tx
        .select({ id: contactPoints.id })
        .from(contactPoints)
        .where(this.ownAddress(recipientId, address));
      if (taken) throw new ConflictException('You already have this email address');
      const [updated] = await tx
        .update(contactPoints)
        .set({ address, verifiedAt: null, source: 'user' })
        .where(eq(contactPoints.id, contactPointId))
        .returning(ownColumns);
      if (!updated) throw new Error('Updating the contact point returned no row');
      await tx.delete(verificationTokens).where(eq(verificationTokens.contactPointId, contactPointId));
      return { point: updated, pending: await this.verification.issue(tx, recipientId, contactPointId, address) };
    });
    if (result.pending) await this.verification.send(result.pending);
    return toOwn(result.point);
  }

  /** Removes one of the user's own points, the seeded IdP email included; it is never seeded again (R32, R36). */
  async removeOwn(recipientId: string, contactPointId: string): Promise<void> {
    const [removed] = await this.db
      .delete(contactPoints)
      .where(and(eq(contactPoints.id, contactPointId), this.ownedBy(recipientId)))
      .returning({ id: contactPoints.id });
    if (!removed) throw new NotFoundException();
  }

  /** Sends another confirmation for a pending address, within R36's limits; 409 once it is confirmed. */
  async resend(recipientId: string, contactPointId: string): Promise<void> {
    this.verification.requireAvailable();
    const pending = await this.db.transaction(async (tx) => {
      const point = await this.lockOwn(tx, recipientId, contactPointId);
      if (point.verifiedAt !== null) throw new ConflictException('This email address is already confirmed');
      return this.verification.issue(tx, recipientId, contactPointId, point.address);
    });
    await this.verification.send(pending);
  }

  /**
   * The points a delivery from `senderId` on `channel` goes to (R34): the user's own verified points and the points
   * that sender supplied. Another sender's points are never included (R33). With `onlyId`, just that point is read,
   * so no other point's secret is opened.
   */
  async usable(
    recipientId: string,
    channel: Channel,
    senderId: string,
    { db = this.db, onlyId }: { db?: DbOrTx; onlyId?: string } = {},
  ): Promise<UsableContactPoints> {
    const rows = await db
      .select({ ...ownColumns, ownerSenderId: contactPoints.ownerSenderId, signingSecret: contactPoints.signingSecret })
      .from(contactPoints)
      .where(
        and(
          visibleToSender(recipientId, channel, senderId),
          onlyId === undefined ? undefined : eq(contactPoints.id, onlyId),
        ),
      )
      .orderBy(asc(contactPoints.createdAt), asc(contactPoints.address));
    const isUsable = (row: (typeof rows)[number]) => row.ownerSenderId !== null || row.verifiedAt !== null;
    return {
      points: rows.filter(isUsable).map((row) => ({
        id: row.id,
        address: row.address,
        ownerSenderId: row.ownerSenderId,
        signingSecret: row.signingSecret && this.cipher.decrypt(row.signingSecret, signingSecretLocation(row.id)),
      })),
      pendingVerification: rows.some((row) => !isUsable(row)),
    };
  }

  /** Adds points a sender supplied, trusted as given (R33, R35). Points it already supplied are left as they are. */
  async addSenderPoints(
    recipientId: string,
    senderId: string,
    points: readonly SenderContactPoint[],
    db: DbOrTx = this.db,
  ): Promise<void> {
    if (points.length === 0) return;
    const verifiedAt = new Date();
    await db
      .insert(contactPoints)
      .values(
        points.map((point) => ({
          ...point,
          recipientId,
          ownerSenderId: senderId,
          source: 'sender' as const,
          verifiedAt,
        })),
      )
      .onConflictDoNothing();
  }

  /**
   * Seeds the IdP email as the user's own point (R32): verified when the token says so (R35). Returns the point to
   * confirm when it is not verified; null when the user already has the address.
   */
  async seedIdpEmail(
    tx: NotificationTransaction,
    recipientId: string,
    address: string,
    verified: boolean,
  ): Promise<string | null> {
    const [seeded] = await tx
      .insert(contactPoints)
      .values({
        recipientId,
        channel: 'email',
        address,
        ownerSenderId: null,
        source: 'idp',
        verifiedAt: verified ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning({ id: contactPoints.id });
    return seeded && !verified ? seeded.id : null;
  }

  /** Issues and sends the seeded IdP email's confirmation. */
  async confirmSeed(recipientId: string, contactPointId: string, address: string): Promise<void> {
    const pending: PendingConfirmation = await this.db.transaction((tx) =>
      this.verification.issue(tx, recipientId, contactPointId, address),
    );
    await this.verification.send(pending);
  }

  private ownedBy(recipientId: string) {
    return and(eq(contactPoints.recipientId, recipientId), isNull(contactPoints.ownerSenderId));
  }

  private ownAddress(recipientId: string, address: string) {
    return and(this.ownedBy(recipientId), eq(contactPoints.channel, 'email'), eq(contactPoints.address, address));
  }

  private async lockOwn(tx: NotificationTransaction, recipientId: string, contactPointId: string): Promise<OwnRow> {
    const [point] = await tx
      .select(ownColumns)
      .from(contactPoints)
      .where(and(eq(contactPoints.id, contactPointId), this.ownedBy(recipientId)))
      .for('update');
    if (!point) throw new NotFoundException();
    return point;
  }
}
