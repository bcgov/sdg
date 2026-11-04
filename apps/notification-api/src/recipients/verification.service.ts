import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import type { Env } from '../config/env.js';
import {
  InjectDatabase,
  type NotificationDatabase,
  type NotificationTransaction,
} from '../database/database.module.js';
import { contactPoints, verificationTokens } from '../database/schema/index.js';
import { PLATFORM_INTEGRATIONS, type PlatformIntegrations } from '../integrations/platform-defaults.js';
import { sendEmail, type SmtpConfig } from '../integrations/types/smtp.js';
import { OutboundGuard } from '../outbound/outbound-guard.js';
import { renderConfirmationEmail } from './confirmation-email.js';
import { RateLimitService } from './rate-limit.service.js';

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** A confirmation issued inside a transaction, to send once it commits. */
export interface PendingConfirmation {
  readonly address: string;
  readonly token: string;
}

/**
 * Email confirmation (R35, KTD15): hashed, single-use, 24-hour tokens, and the built-in confirmation email, sent at
 * once through the platform default email integration only. These emails are outside quiet hours and outside every
 * sender's history.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);
  private readonly db: NotificationDatabase;
  private readonly rateLimit: RateLimitService;
  private readonly guard: OutboundGuard;
  private readonly smtp: SmtpConfig | null;
  private readonly confirmUrl: string;
  private readonly timeZone: string;

  constructor(
    @InjectDatabase() db: NotificationDatabase,
    @Inject(RateLimitService) rateLimit: RateLimitService,
    @Inject(OutboundGuard) guard: OutboundGuard,
    @Inject(PLATFORM_INTEGRATIONS) defaults: PlatformIntegrations,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.db = db;
    this.rateLimit = rateLimit;
    this.guard = guard;
    this.smtp = defaults.email?.type === 'smtp' ? defaults.email.config : null;
    this.confirmUrl = config.get('CONFIRM_EMAIL_URL', { infer: true });
    this.timeZone = config.get('DEFAULT_TIMEZONE', { infer: true });
  }

  /** Whether confirmations can be sent: there is a platform default email integration. */
  get available(): boolean {
    return this.smtp !== null;
  }

  /** 422 when no confirmation can be sent, so an address that would stay unconfirmable is never added (KTD15). */
  requireAvailable(): void {
    if (!this.available) {
      throw new UnprocessableEntityException(
        'Email addresses cannot be added: no platform email integration is configured to send the confirmation',
      );
    }
  }

  /**
   * Counts the send against R36's limits (a 429 when over) and stores a new token for the contact point. Runs in the
   * caller's transaction; send the result with {@link send} once it commits.
   */
  async issue(
    tx: NotificationTransaction,
    recipientId: string,
    contactPointId: string,
    address: string,
  ): Promise<PendingConfirmation> {
    await this.rateLimit.reserveConfirmation(tx, recipientId, address);
    const token = randomBytes(32).toString('base64url');
    await tx.insert(verificationTokens).values({
      tokenHash: hashToken(token),
      contactPointId,
      address,
      expiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS),
    });
    return { address, token };
  }

  /** Sends the confirmation email now; 502 when the platform integration fails, which is logged. */
  async send({ address, token }: PendingConfirmation): Promise<void> {
    if (!this.smtp) throw new Error('No platform email integration to send the confirmation with');
    const link = new URL(this.confirmUrl);
    link.searchParams.set('token', token);
    const content = await renderConfirmationEmail(address, link.href, this.timeZone);
    const outcome = await sendEmail(this.guard, this.smtp, { to: address, ...content, messageId: randomUUID() });
    if (outcome.status === 'failed') {
      this.logger.error({
        msg: 'Could not send a confirmation email',
        error: outcome.error,
        retryable: outcome.retryable,
      });
      throw new BadGatewayException('The confirmation email could not be sent: try again later');
    }
  }

  /**
   * Confirms the address the token was sent to (KTD15). A token works once and for 24 hours, and only while the
   * contact point still has that address; 400 otherwise.
   */
  async confirm(token: string): Promise<void> {
    const confirmed = await this.db.transaction(async (tx) => {
      const [used] = await tx
        .update(verificationTokens)
        .set({ usedAt: sql`now()` })
        .where(
          and(
            eq(verificationTokens.tokenHash, hashToken(token)),
            isNull(verificationTokens.usedAt),
            gt(verificationTokens.expiresAt, sql`now()`),
          ),
        )
        .returning({ contactPointId: verificationTokens.contactPointId, address: verificationTokens.address });
      if (!used) return false;
      const [point] = await tx
        .update(contactPoints)
        .set({ verifiedAt: sql`coalesce(${contactPoints.verifiedAt}, now())` })
        .where(and(eq(contactPoints.id, used.contactPointId), eq(contactPoints.address, used.address)))
        .returning({ id: contactPoints.id });
      return point !== undefined;
    });
    if (!confirmed) throw new BadRequestException('This confirmation link is invalid, already used or expired');
  }
}
