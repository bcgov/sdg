import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';

import type { DbOrTx } from '../database/database.module.js';
import { deliveries, notificationRecipients } from '../database/schema/index.js';

const MINUTE_MS = 60_000;

/** Why an escalation step ended `cancelled` (R18, R54). */
export const CANCEL_REASONS = { read: 'read in app', acknowledged: 'acknowledged in app' } as const;

/**
 * Schedules the recipient's next escalation step once every delivery of the steps before it has a final status
 * (KTD8): its `due_at` becomes `now` plus its delay. Steps whose rows all ended (skipped at planning, say) are passed
 * over in the same call. The caller holds the notification recipient's row lock, so two deliveries of one step
 * finishing at once can't both miss the moment the step completes.
 */
export async function advanceEscalation(db: DbOrTx, notificationRecipientId: string, now: Date): Promise<void> {
  const rows = await db
    .select({
      id: deliveries.id,
      step: deliveries.step,
      status: deliveries.status,
      dueAt: deliveries.dueAt,
      delayMinutes: deliveries.delayMinutes,
    })
    .from(deliveries)
    .where(and(eq(deliveries.notificationRecipientId, notificationRecipientId), gt(deliveries.step, 0)))
    .orderBy(asc(deliveries.step));
  const steps = [...new Set(rows.map((row) => row.step))];
  for (const step of steps) {
    const stepRows = rows.filter((row) => row.step === step);
    const waiting = stepRows.filter((row) => row.status === 'scheduled' && row.dueAt === null);
    const [first] = waiting;
    if (first) {
      // Every row of a step shares its delay.
      const dueAt = new Date(now.getTime() + first.delayMinutes * MINUTE_MS);
      // oxlint-disable-next-line no-await-in-loop -- the loop ends at the first step still to schedule.
      await db
        .update(deliveries)
        .set({ dueAt, updatedAt: now })
        .where(
          inArray(
            deliveries.id,
            waiting.map((row) => row.id),
          ),
        );
      return;
    }
    if (stepRows.some((row) => row.status === 'scheduled' || row.status === 'sending')) return;
  }
}

/**
 * Stops the recipient's escalation (R18): called when they read or acknowledge the in-app item. Every escalation step
 * still scheduled ends `cancelled`, and a step that was in flight is cancelled if it comes back for a retry. All-at-
 * once deliveries are not an escalation and go on. Resolves how many steps it cancelled; repeating it is harmless.
 */
export async function cancelPendingSteps(
  db: DbOrTx,
  notificationRecipientId: string,
  cause: keyof typeof CANCEL_REASONS = 'read',
  at: Date = new Date(),
): Promise<number> {
  await db
    .update(notificationRecipients)
    .set({ escalationStoppedAt: at })
    .where(
      and(eq(notificationRecipients.id, notificationRecipientId), isNull(notificationRecipients.escalationStoppedAt)),
    );
  const cancelled = await db
    .update(deliveries)
    .set({ status: 'cancelled', reason: CANCEL_REASONS[cause], finishedAt: at, updatedAt: at })
    .where(
      and(
        eq(deliveries.notificationRecipientId, notificationRecipientId),
        gt(deliveries.step, 0),
        eq(deliveries.status, 'scheduled'),
      ),
    )
    .returning({ id: deliveries.id });
  return cancelled.length;
}
