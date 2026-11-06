import { Inject, Injectable, Logger } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { and, eq } from 'drizzle-orm';

import { CHANNEL_DECLARATIONS } from '../channels/channels.js';
import { InjectDatabase, type NotificationDatabase } from '../database/database.module.js';
import {
  deliveries,
  deliveryAttempts,
  notificationRecipients,
  notifications,
  recipients,
} from '../database/schema/index.js';
import { IntegrationResolver } from '../integrations/resolver.service.js';
import { describeError } from '../logging/describe-error.js';
import { ContactPointsService, type UsableContactPoint } from '../recipients/contact-points.service.js';
import { TemplateRenderError } from '../templates/render-error.js';
import { DEFAULT_TIME_ZONE, RenderService } from '../templates/render.service.js';
import { queueFailureCallback } from './callbacks.js';
import { ChannelSenders } from './channel-senders.js';
import { DeliveryClaimer, type ClaimedDelivery } from './claimer.js';
import { advanceEscalation, CANCEL_REASONS } from './escalation.js';
import { transition, type AttemptRecord, type AttemptResult } from './outcomes.js';
import { SKIP_REASONS } from './planner.js';
import { nextAllowedInstant } from './quiet-hours.js';
import { FAILURE_REASONS, isReclaimedFinalAttempt } from './retry.js';
import { CLOCK, type Clock } from './settings.js';

/** What a delivery reads at claim (KTD7): the pinned send, and the recipient's settings as they are now. */
function deliveryContext(db: NotificationDatabase, notificationRecipientId: string) {
  return db
    .select({
      senderId: notifications.senderId,
      pinned: notifications.pinned,
      data: notifications.data,
      kind: recipients.kind,
      language: recipients.language,
      timeZone: recipients.timeZone,
      quietHoursStart: recipients.quietHoursStart,
      quietHoursEnd: recipients.quietHoursEnd,
      channelsOff: recipients.channelsOff,
      escalationStoppedAt: notificationRecipients.escalationStoppedAt,
    })
    .from(notificationRecipients)
    .innerJoin(notifications, eq(notifications.id, notificationRecipients.notificationId))
    .innerJoin(recipients, eq(recipients.id, notificationRecipients.recipientId))
    .where(eq(notificationRecipients.id, notificationRecipientId));
}

type DeliveryContext = Awaited<ReturnType<typeof deliveryContext>>[number];

const tracer = trace.getTracer('notification-api');

/**
 * Works one claimed delivery (KTD7, KTD9): re-checks the escalation, channel switch, contact point and quiet hours,
 * renders from the pinned versions in the recipient's language and zone, resolves the integration and sends; then
 * records the outcome under the claim.
 */
@Injectable()
export class DeliveryWorker {
  private readonly logger = new Logger(DeliveryWorker.name);
  private readonly db: NotificationDatabase;
  private readonly claimer: DeliveryClaimer;
  private readonly contactPoints: ContactPointsService;
  private readonly render: RenderService;
  private readonly integrations: IntegrationResolver;
  private readonly senders: ChannelSenders;
  private readonly defaultTimeZone: string;
  private readonly clock: Clock;

  constructor(
    @InjectDatabase() db: NotificationDatabase,
    @Inject(DeliveryClaimer) claimer: DeliveryClaimer,
    @Inject(ContactPointsService) contactPoints: ContactPointsService,
    @Inject(RenderService) render: RenderService,
    @Inject(IntegrationResolver) integrations: IntegrationResolver,
    @Inject(ChannelSenders) senders: ChannelSenders,
    @Inject(DEFAULT_TIME_ZONE) defaultTimeZone: string,
    @Inject(CLOCK) clock: Clock,
  ) {
    this.db = db;
    this.claimer = claimer;
    this.contactPoints = contactPoints;
    this.render = render;
    this.integrations = integrations;
    this.senders = senders;
    this.defaultTimeZone = defaultTimeZone;
    this.clock = clock;
  }

  /** Claims and works up to a batch of due deliveries; resolves how many it claimed. */
  async deliverBatch(): Promise<number> {
    const claimed = await this.claimer.claim();
    await Promise.all(claimed.map((delivery) => this.process(delivery)));
    return claimed.length;
  }

  /** Works and records one delivery, in a span. An unexpected error is logged; the lease then lets it be reclaimed. */
  process(claimed: ClaimedDelivery): Promise<void> {
    const attributes = { 'delivery.id': claimed.id, 'delivery.channel': claimed.channel };
    return tracer.startActiveSpan('notification.deliver', { attributes }, async (span) => {
      try {
        await this.record(claimed, await this.attempt(claimed));
      } catch (error) {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({ code: SpanStatusCode.ERROR });
        this.logger.error({ msg: 'Working a delivery failed', deliveryId: claimed.id, error: describeError(error) });
      } finally {
        span.end();
      }
    });
  }

  /** Everything up to and including the send, without recording it. */
  async attempt(claimed: ClaimedDelivery): Promise<AttemptResult> {
    const [context] = await deliveryContext(this.db, claimed.notificationRecipientId);
    if (!context) throw new Error(`Delivery ${claimed.id} has no notification recipient`);
    const checked = await this.check(claimed, context);
    if (!('point' in checked)) return checked;
    return this.send(claimed, context, checked.point);
  }

  /** The checks a delivery must pass at claim, or the point to send to. */
  private async check(
    claimed: ClaimedDelivery,
    context: DeliveryContext,
  ): Promise<AttemptResult | { point: UsableContactPoint }> {
    if (claimed.step > 0 && context.escalationStoppedAt) return { kind: 'cancelled', reason: CANCEL_REASONS.read };
    if (isReclaimedFinalAttempt(claimed.attempts))
      return { kind: 'failed', reason: FAILURE_REASONS.exhausted, attempt: null };
    const declaration = CHANNEL_DECLARATIONS[claimed.channel];
    if (declaration.switchable && context.channelsOff.includes(claimed.channel)) {
      return { kind: 'skipped', reason: SKIP_REASONS.channelOff };
    }
    const point = await this.usablePoint(claimed, context);
    if (!point) return { kind: 'skipped', reason: SKIP_REASONS.noUsableContactPoint };
    const { quietHoursStart: start, quietHoursEnd: end } = context;
    if (context.kind === 'user' && declaration.quietHours === 'hold' && start !== null && end !== null) {
      const now = this.clock.now();
      const until = nextAllowedInstant(now, { start, end }, context.timeZone ?? this.defaultTimeZone);
      if (until > now) return { kind: 'held', until };
    }
    return { point };
  }

  /** The planned point when it is still there and usable for this sender: removed or unverified ones are not. */
  private async usablePoint(claimed: ClaimedDelivery, context: DeliveryContext): Promise<UsableContactPoint | null> {
    if (claimed.contactPointId === null) return null;
    const { points } = await this.contactPoints.usable(claimed.recipientId, claimed.channel, context.senderId, {
      onlyId: claimed.contactPointId,
    });
    return points.find((point) => point.id === claimed.contactPointId) ?? null;
  }

  private async send(
    claimed: ClaimedDelivery,
    context: DeliveryContext,
    point: UsableContactPoint,
  ): Promise<AttemptResult> {
    const unsent = { integrationId: null, integrationVersion: null, rendered: null, status: 'failed' } as const;
    let rendered;
    try {
      rendered = await this.render.render({
        ...context,
        channel: claimed.channel,
        recipientId: claimed.recipientId,
        notificationId: claimed.notificationId,
        recipientKind: context.kind,
      });
    } catch (error) {
      if (!(error instanceof TemplateRenderError)) throw error;
      return { kind: 'failed', reason: FAILURE_REASONS.renderFailed, attempt: { ...unsent, error: error.message } };
    }
    if (rendered.status === 'no-template') return { kind: 'skipped', reason: SKIP_REASONS.noTemplate };
    // Resolved on every attempt: a deleted override with no default fails without retry (KTD9).
    const integration = await this.integrations.resolve(context.senderId, claimed.channel);
    if (!integration) {
      const attempt = { ...unsent, rendered: rendered.parts, error: FAILURE_REASONS.noIntegration };
      return { kind: 'failed', reason: FAILURE_REASONS.noIntegration, attempt };
    }
    const outcome = await this.senders.send({ deliveryId: claimed.id, integration, point, rendered: rendered.parts });
    const attempt: AttemptRecord = {
      integrationId: integration.id,
      integrationVersion: integration.version,
      rendered: rendered.parts,
      status: outcome.status,
      error: outcome.status === 'failed' ? outcome.error : null,
    };
    return { kind: 'sent', outcome, attempt };
  }

  /**
   * Records the result under the claim, with the recipient's row locked so escalation steps finishing together
   * schedule the next one exactly once. A claim that was reclaimed meanwhile records nothing.
   */
  async record(claimed: ClaimedDelivery, result: AttemptResult): Promise<void> {
    const now = this.clock.now();
    const change = transition(claimed, result, now);
    await this.db.transaction(async (tx) => {
      await tx
        .select({ id: notificationRecipients.id })
        .from(notificationRecipients)
        .where(eq(notificationRecipients.id, claimed.notificationRecipientId))
        .for('update');
      const [updated] = await tx
        .update(deliveries)
        .set(change.set)
        .where(
          and(
            eq(deliveries.id, claimed.id),
            eq(deliveries.status, 'sending'),
            eq(deliveries.attempts, claimed.attempts),
          ),
        )
        .returning({ id: deliveries.id });
      if (!updated) {
        this.logger.warn({ msg: 'A delivery was reclaimed before its outcome was recorded', deliveryId: claimed.id });
        return;
      }
      if (change.attempt) {
        await tx
          .insert(deliveryAttempts)
          .values({ ...change.attempt, deliveryId: claimed.id, attempt: claimed.attempts, createdAt: now });
      }
      if (change.callback) await queueFailureCallback(tx, claimed.id, now);
      if (change.final && claimed.step > 0) await advanceEscalation(tx, claimed.notificationRecipientId, now);
    });
  }
}
