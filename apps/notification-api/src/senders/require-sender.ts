import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import type { NotificationDatabase } from '../database/database.module.js';
import { senders } from '../database/schema/index.js';

/** 404, with `message` when given, unless the sender exists. */
export async function requireSender(
  db: Pick<NotificationDatabase, 'select'>,
  senderId: string,
  message?: string,
): Promise<void> {
  const [sender] = await db.select({ id: senders.id }).from(senders).where(eq(senders.id, senderId));
  if (!sender) throw new NotFoundException(message);
}
