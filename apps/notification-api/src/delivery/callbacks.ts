import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { SecretCipher } from '../crypto/secret-cipher.js';
import { InjectDatabase, type DbOrTx, type NotificationDatabase } from '../database/database.module.js';
import { deliveries, failureCallbacks, notifications, senders } from '../database/schema/index.js';
import { sendWebhook } from '../integrations/types/webhook.js';
import { describeError } from '../logging/describe-error.js';
import { GuardedHttpClient } from '../outbound/http-dispatcher.js';
import { failed, type SendOutcome } from '../outbound/outcome.js';
import { callbackSecretLocation } from '../senders/senders.service.js';
import { claimDue } from './claimer.js';
import { afterAttempt, FAILURE_REASONS, isReclaimedFinalAttempt } from './retry.js';
import { CLOCK, DELIVERY_SETTINGS, type Clock, type DeliverySettings } from './settings.js';

/** The body of a failure callback: which delivery failed and why (R42). */
export interface FailureCallbackBody {
  type: 'delivery.failed';
  deliveryId: string;
  notificationId: string;
  notificationType: string;
  recipientId: string;
  channel: string;
  reason: string | null;
  attempts: number;
}

/**
 * Queues the failed delivery's callback in the transaction that marks it failed, when its sender has a callback URL
 * (R42). One per delivery: a repeated failure record queues nothing more.
 */
export async function queueFailureCallback(db: DbOrTx, deliveryId: string, now: Date): Promise<void> {
  await db.execute(sql`
    INSERT INTO failure_callbacks (delivery_id, sender_id, due_at)
    SELECT d.id, n.sender_id, ${now.toISOString()}::timestamptz
    FROM deliveries d
    JOIN notifications n ON n.id = d.notification_id
    JOIN senders s ON s.id = n.sender_id
    WHERE d.id = ${deliveryId} AND s.callback_url IS NOT NULL
    ON CONFLICT (delivery_id) DO NOTHING`);
}

const claimedCallbackColumns = {
  id: failureCallbacks.id,
  deliveryId: failureCallbacks.deliveryId,
  senderId: failureCallbacks.senderId,
  attempts: failureCallbacks.attempts,
};

interface ClaimedCallback {
  id: string;
  deliveryId: string;
  senderId: string;
  attempts: number;
}

/**
 * Calls senders' failure callback URLs (R42, KTD10): a Standard Webhooks request signed with the callback's own
 * secret, whose `webhook-id` is the failed delivery's stable ID, so a repeat after a crash carries the same ID
 * (AE11). Callbacks are claimed and retried like deliveries, with the same bounds (KTD17).
 */
@Injectable()
export class CallbackService {
  private readonly logger = new Logger(CallbackService.name);
  private readonly db: NotificationDatabase;
  private readonly cipher: SecretCipher;
  private readonly http: GuardedHttpClient;
  private readonly settings: DeliverySettings;
  private readonly clock: Clock;

  constructor(
    @InjectDatabase() db: NotificationDatabase,
    @Inject(SecretCipher) cipher: SecretCipher,
    @Inject(GuardedHttpClient) http: GuardedHttpClient,
    @Inject(DELIVERY_SETTINGS) settings: DeliverySettings,
    @Inject(CLOCK) clock: Clock,
  ) {
    this.db = db;
    this.cipher = cipher;
    this.http = http;
    this.settings = settings;
    this.clock = clock;
  }

  /** Claims and sends up to a batch of due callbacks; resolves how many it claimed. */
  async sendBatch(): Promise<number> {
    const claimed = await this.claim();
    await Promise.all(claimed.map((callback) => this.process(callback)));
    return claimed.length;
  }

  private claim(): Promise<ClaimedCallback[]> {
    return claimDue(this.db, failureCallbacks, claimedCallbackColumns, {
      now: this.clock.now(),
      limit: this.settings.batchSize,
      leaseMs: this.settings.leaseMs,
    });
  }

  private async process(callback: ClaimedCallback): Promise<void> {
    try {
      const outcome = isReclaimedFinalAttempt(callback.attempts)
        ? failed(true, FAILURE_REASONS.exhausted)
        : await this.send(callback);
      await this.record(callback, outcome);
    } catch (error) {
      // The lease runs out and another poll claims it again.
      this.logger.error({
        msg: 'Sending a failure callback failed',
        callbackId: callback.id,
        error: describeError(error),
      });
    }
  }

  /** Null outcome: the sender no longer has a callback URL. */
  private async send(callback: ClaimedCallback): Promise<SendOutcome | null> {
    const [row] = await this.db
      .select({
        url: senders.callbackUrl,
        sealedSecret: senders.callbackSecret,
        delivery: {
          id: deliveries.id,
          notificationId: deliveries.notificationId,
          recipientId: deliveries.recipientId,
          channel: deliveries.channel,
          reason: deliveries.reason,
          attempts: deliveries.attempts,
        },
        typeKey: notifications.typeKey,
      })
      .from(deliveries)
      .innerJoin(notifications, eq(notifications.id, deliveries.notificationId))
      .innerJoin(senders, eq(senders.id, notifications.senderId))
      .where(eq(deliveries.id, callback.deliveryId));
    if (!row?.url || !row.sealedSecret) return null;
    const secret = this.cipher.decrypt(row.sealedSecret, callbackSecretLocation(callback.senderId));
    const { delivery } = row;
    const body: FailureCallbackBody = {
      type: 'delivery.failed',
      deliveryId: delivery.id,
      notificationId: delivery.notificationId,
      notificationType: row.typeKey,
      recipientId: delivery.recipientId,
      channel: delivery.channel,
      reason: delivery.reason,
      attempts: delivery.attempts,
    };
    return sendWebhook(this.http, { url: row.url, secret, deliveryId: delivery.id, body: JSON.stringify(body) });
  }

  private async record(callback: ClaimedCallback, outcome: SendOutcome | null): Promise<void> {
    const now = this.clock.now();
    const set = outcomeUpdate(outcome, callback.attempts, now);
    if (set.status === 'failed') {
      this.logger.error({ msg: 'A failure callback failed for good', callbackId: callback.id, reason: set.reason });
    }
    // Only the claim that is still current records: a reclaimed callback belongs to its new claim.
    await this.db
      .update(failureCallbacks)
      .set(set)
      .where(
        and(
          eq(failureCallbacks.id, callback.id),
          eq(failureCallbacks.status, 'sending'),
          eq(failureCallbacks.attempts, callback.attempts),
        ),
      );
  }
}

type CallbackUpdate = Partial<typeof failureCallbacks.$inferInsert>;

function outcomeUpdate(outcome: SendOutcome | null, attempt: number, now: Date): CallbackUpdate {
  const base = { leaseUntil: null, updatedAt: now };
  if (outcome === null) return { ...base, status: 'skipped', reason: 'no callback URL' };
  const lastError = outcome.status === 'failed' ? outcome.error : null;
  const decision = afterAttempt(outcome, attempt, now);
  if (decision.kind === 'done') return { ...base, status: 'delivered', lastError };
  if (decision.kind === 'retry') return { ...base, status: 'scheduled', dueAt: decision.dueAt, lastError };
  return { ...base, status: 'failed', reason: decision.reason, lastError };
}
