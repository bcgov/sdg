import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { recipients } from '@repo/notification-database';
import { eq, sql } from 'drizzle-orm';

import { CHANNEL_DECLARATIONS } from '../channels/channels.js';
import { InjectDatabase, type NotificationDatabase } from '../database/database.module.js';
import type { SettingsResponse, UpdateSettings } from './recipients.schemas.js';

/** The channels a user sees in their settings. Webhooks go only to systems (R33). */
const USER_CHANNELS = ['in-app', 'email'] as const;
type UserChannel = (typeof USER_CHANNELS)[number];

const settingsColumns = {
  id: recipients.id,
  language: recipients.language,
  timeZone: recipients.timeZone,
  quietHoursStart: recipients.quietHoursStart,
  quietHoursEnd: recipients.quietHoursEnd,
  channelsOff: recipients.channelsOff,
};

interface SettingsRow {
  id: string;
  language: string | null;
  timeZone: string | null;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  channelsOff: string[];
}

function toSettings(row: SettingsRow): SettingsResponse {
  const { quietHoursStart: start, quietHoursEnd: end } = row;
  return {
    id: row.id,
    language: row.language,
    timeZone: row.timeZone,
    quietHours: start !== null && end !== null ? { start, end } : null,
    channels: USER_CHANNELS.map((channel) => ({
      channel,
      enabled: !row.channelsOff.includes(channel),
      switchable: CHANNEL_DECLARATIONS[channel].switchable,
    })),
  };
}

/** A user's preferences (R37, R39, R40): the email channel switch, language, timezone and quiet hours. */
@Injectable()
export class SettingsService {
  private readonly db: NotificationDatabase;

  constructor(@InjectDatabase() db: NotificationDatabase) {
    this.db = db;
  }

  async get(recipientId: string): Promise<SettingsResponse> {
    const [row] = await this.db.select(settingsColumns).from(recipients).where(eq(recipients.id, recipientId));
    if (!row) throw new NotFoundException();
    return toSettings(row);
  }

  /** Sets the keys given; null clears one. */
  async update(recipientId: string, input: UpdateSettings): Promise<SettingsResponse> {
    const { quietHours, ...rest } = input;
    const values = {
      ...rest,
      ...(quietHours === undefined
        ? {}
        : { quietHoursStart: quietHours?.start ?? null, quietHoursEnd: quietHours?.end ?? null }),
    };
    if (Object.keys(values).length === 0) return this.get(recipientId);
    const [row] = await this.db
      .update(recipients)
      .set(values)
      .where(eq(recipients.id, recipientId))
      .returning(settingsColumns);
    if (!row) throw new NotFoundException();
    return toSettings(row);
  }

  /** Switches a channel on or off (R37). In-app is always on: switching it off is a 400. */
  async setChannel(recipientId: string, channel: UserChannel, enabled: boolean): Promise<SettingsResponse> {
    if (!CHANNEL_DECLARATIONS[channel].switchable) {
      if (enabled) return this.get(recipientId);
      throw new BadRequestException(`The ${channel} channel cannot be switched off`);
    }
    const channelsOff = enabled
      ? sql`array_remove(${recipients.channelsOff}, ${channel})`
      : sql`array_append(array_remove(${recipients.channelsOff}, ${channel}), ${channel})`;
    const [row] = await this.db
      .update(recipients)
      .set({ channelsOff })
      .where(eq(recipients.id, recipientId))
      .returning(settingsColumns);
    if (!row) throw new NotFoundException();
    return toSettings(row);
  }
}
