import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { policyChannels, type DeliveryPolicy, type PolicyChannel } from '../catalog/policy.js';
import { InjectDatabase, type DbOrTx, type NotificationDatabase } from '../database/database.module.js';
import {
  contactPoints,
  deliveries,
  inboxItems,
  notificationRecipients,
  notifications,
  recipients,
  type RecipientKind,
} from '../database/schema/index.js';
import { describeError } from '../logging/describe-error.js';
import { visibleToSender } from '../recipients/contact-points.service.js';
import { TemplateRenderError } from '../templates/render-error.js';
import { RenderService } from '../templates/render.service.js';
import { advanceEscalation } from './escalation.js';
import { CLOCK, DELIVERY_SETTINGS, type Clock, type DeliverySettings } from './settings.js';

/** Why a delivery ended `skipped` (R54). */
export const SKIP_REASONS = {
  channelOff: 'channel off',
  noContactPoint: 'no contact point',
  noUsableContactPoint: 'no usable contact point',
  noTemplate: 'no template',
} as const;

/** One delivery step for a recipient: step 0 is all at once, steps 1… escalate (KTD8). */
export interface PlannedStep {
  step: number;
  channel: PolicyChannel;
  delayMinutes: number;
}

/**
 * The steps the policy gives a recipient (R14, R19): escalation only for users, who have an inbox; address-only
 * recipients and systems get every policy channel at once.
 */
export function plannedSteps(policy: DeliveryPolicy, kind: RecipientKind): PlannedStep[] {
  if (kind === 'user' && policy.mode === 'escalation') {
    return policy.steps.map((step, index) => ({ ...step, step: index + 1 }));
  }
  return policyChannels(policy).map((channel) => ({ step: 0, channel, delayMinutes: 0 }));
}

const targetColumns = {
  id: notificationRecipients.id,
  notificationId: notificationRecipients.notificationId,
  recipientId: notificationRecipients.recipientId,
  kind: recipients.kind,
  language: recipients.language,
  timeZone: recipients.timeZone,
  senderId: notifications.senderId,
  pinned: notifications.pinned,
  data: notifications.data,
  policy: notifications.policy,
};

/** Recipients still to plan, oldest first, with what planning needs from the notification and the recipient. */
function unplannedTargets(db: DbOrTx, limit: number) {
  return db
    .select(targetColumns)
    .from(notificationRecipients)
    .innerJoin(notifications, eq(notifications.id, notificationRecipients.notificationId))
    .innerJoin(recipients, eq(recipients.id, notificationRecipients.recipientId))
    .where(isNull(notificationRecipients.plannedAt))
    .orderBy(asc(notificationRecipients.createdAt))
    .limit(limit);
}

type PlanTarget = Awaited<ReturnType<typeof unplannedTargets>>[number];

type InboxContent = Pick<
  typeof inboxItems.$inferInsert,
  'title' | 'body' | 'actionUrl' | 'language' | 'templateVersionId'
>;

type DeliveryRow = typeof deliveries.$inferInsert;

/**
 * Plans each expanded recipient once (KTD7): the in-app item for a user (R38), then one delivery per step, channel
 * and contact point that is usable or pending verification now, and one `skipped` "no contact point" row for a
 * channel with none. All-at-once emails to points usable now are deduplicated by address across the notification
 * (KTD14).
 */
@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);
  private readonly db: NotificationDatabase;
  private readonly render: RenderService;
  private readonly settings: DeliverySettings;
  private readonly clock: Clock;

  constructor(
    @InjectDatabase() db: NotificationDatabase,
    @Inject(RenderService) render: RenderService,
    @Inject(DELIVERY_SETTINGS) settings: DeliverySettings,
    @Inject(CLOCK) clock: Clock,
  ) {
    this.db = db;
    this.render = render;
    this.settings = settings;
    this.clock = clock;
  }

  /** Plans up to a batch of recipients, oldest first, and resolves how many it planned. */
  async planBatch(): Promise<number> {
    const targets = await unplannedTargets(this.db, this.settings.batchSize);
    const planned = await Promise.all(targets.map((target) => this.plan(target)));
    return planned.filter(Boolean).length;
  }

  /** False when another worker planned it first. */
  private async plan(target: PlanTarget): Promise<boolean> {
    // Rendered before the transaction: rendering reads the pinned versions on its own connection.
    const inbox = target.kind === 'user' ? await this.inboxContent(target) : null;
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: notificationRecipients.id })
        .from(notificationRecipients)
        .where(and(eq(notificationRecipients.id, target.id), isNull(notificationRecipients.plannedAt)))
        .for('update', { skipLocked: true });
      if (!locked) return false;
      const now = this.clock.now();
      if (inbox) {
        const { id: notificationRecipientId, notificationId, recipientId } = target;
        await tx
          .insert(inboxItems)
          .values({ ...inbox, notificationRecipientId, notificationId, recipientId, createdAt: now });
      }
      const rows = await this.deliveryRows(tx, target, now);
      if (rows.length > 0) await tx.insert(deliveries).values(rows).onConflictDoNothing();
      await advanceEscalation(tx, target.id, now);
      await tx.update(notificationRecipients).set({ plannedAt: now }).where(eq(notificationRecipients.id, target.id));
      return true;
    });
  }

  /** The in-app item's content, rendered from the pinned in-app template (R25, R39). */
  private async inboxContent(target: PlanTarget): Promise<InboxContent> {
    const empty = { title: null, body: null, actionUrl: null, language: null, templateVersionId: null };
    try {
      const result = await this.render.render({
        pinned: target.pinned,
        channel: 'in-app',
        language: target.language,
        timeZone: target.timeZone,
        data: target.data,
        recipientId: target.recipientId,
        notificationId: target.notificationId,
        recipientKind: target.kind,
      });
      if (result.status === 'no-template' || result.parts.channel !== 'in-app') return empty;
      const { title, body, actionUrl } = result.parts;
      return { title, body, actionUrl, language: result.language, templateVersionId: result.templateVersionId };
    } catch (error) {
      if (!(error instanceof TemplateRenderError)) throw error;
      // The item is still created: it is the inbox's record and the read that stops an escalation (R18, R38).
      this.logger.warn({
        msg: 'The in-app item failed to render',
        notificationId: target.notificationId,
        error: describeError(error),
      });
      return empty;
    }
  }

  private async deliveryRows(tx: DbOrTx, target: PlanTarget, now: Date): Promise<DeliveryRow[]> {
    const steps = plannedSteps(target.policy, target.kind);
    const pointsByChannel = new Map<PolicyChannel, PlannablePoint[]>();
    for (const channel of new Set(steps.map((step) => step.channel))) {
      // oxlint-disable-next-line no-await-in-loop -- at most two channels, on the transaction's one connection.
      pointsByChannel.set(channel, await plannablePoints(tx, target.recipientId, channel, target.senderId));
    }
    return steps.flatMap((step): DeliveryRow[] => {
      const points = pointsByChannel.get(step.channel) ?? [];
      if (points.length === 0) {
        return [
          deliveryRow(target, step, now, { status: 'skipped', reason: SKIP_REASONS.noContactPoint, finishedAt: now }),
        ];
      }
      const dueAt = step.step === 0 ? now : null;
      return points.map((point) =>
        deliveryRow(target, step, now, {
          contactPointId: point.id,
          address: point.address,
          dedupeKey: dedupeKey(step, point),
          dueAt,
        }),
      );
    });
  }
}

function deliveryRow(target: PlanTarget, step: PlannedStep, now: Date, fields: Partial<DeliveryRow>): DeliveryRow {
  return {
    notificationId: target.notificationId,
    notificationRecipientId: target.id,
    recipientId: target.recipientId,
    channel: step.channel,
    step: step.step,
    delayMinutes: step.delayMinutes,
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}

interface PlannablePoint {
  id: string;
  address: string;
  /** Verified or sender-supplied now; otherwise pending verification. */
  usable: boolean;
}

/**
 * The key that merges a row with other recipients' rows to the same mailbox (KTD14): only an all-at-once email to a
 * point usable now. A pending point may still be skipped at claim and an escalation step cancelled by its own
 * recipient's read, so either keeps its own row rather than standing in for another recipient's email.
 */
function dedupeKey(step: PlannedStep, point: PlannablePoint): string | null {
  return step.channel === 'email' && step.step === 0 && point.usable ? point.address : null;
}

/**
 * The recipient's points on the channel a delivery from the sender may go to (R34): the user's own and the ones that
 * sender supplied, usable (verified or sender-supplied) first, then those still pending verification, which the
 * worker re-checks at claim (KTD7). One per address, so a mailbox gets one email (KTD14).
 */
async function plannablePoints(
  db: DbOrTx,
  recipientId: string,
  channel: PolicyChannel,
  senderId: string,
): Promise<PlannablePoint[]> {
  const usable = sql<boolean>`(${contactPoints.ownerSenderId} IS NOT NULL OR ${contactPoints.verifiedAt} IS NOT NULL)`;
  const rows = await db
    .select({ id: contactPoints.id, address: contactPoints.address, usable })
    .from(contactPoints)
    .where(visibleToSender(recipientId, channel, senderId))
    .orderBy(desc(usable), asc(contactPoints.createdAt), asc(contactPoints.address));
  const byAddress = new Map<string, PlannablePoint>();
  for (const row of rows) if (!byAddress.has(row.address)) byAddress.set(row.address, row);
  return [...byAddress.values()];
}
